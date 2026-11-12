package main

// Sicherung: Die Lehrkraft lädt alle Daten (Klassen, Schüler, Arbeiten, Freischaltungen,
// Musterlösungs-Freigaben, Vorführungen, eigene Aufgaben) als eine Datei herunter und kann
// sie später – auch auf einem anderen Rechner – wiederherstellen.
//
// Die Sicherung enthält genau den Inhalt der Datendatei, nur ohne Lehrer-Passwort und
// Raumcode. Diese beiden gehören zum Rechner, auf dem der Server läuft, und bleiben beim
// Wiederherstellen so, wie sie sind. Neue Felder der Datendatei kommen so automatisch mit.

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

const backupFormat = "netzwerkstatt-sicherung"
const backupVersion = 1

// Größte Sicherungsdatei, die der Server annimmt (viele Klassen mit allen Arbeiten).
const maxBackupSize = 256 << 20

const maxStudents = 20000

type backupFile struct {
	Format  string          `json:"format"`
	Version int             `json:"version"`
	Program string          `json:"programVersion"`
	Created int64           `json:"created"`
	Note    string          `json:"hinweis"`
	Data    json.RawMessage `json:"data"`
}

// Felder, die nicht in die Sicherung gehören und beim Wiederherstellen bleiben.
var backupSkip = map[string]bool{"RoomCode": true, "TeacherPassword": true}

// backupLocked erzeugt die Sicherungsdatei. Aufrufer muss s.mu halten.
func (s *Store) backupLocked() ([]byte, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	delete(m, "roomCode")
	delete(m, "teacherPassword")
	data, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return json.Marshal(backupFile{
		Format:  backupFormat,
		Version: backupVersion,
		Program: Version,
		Created: time.Now().Unix(),
		Note:    "Sicherung der NetzWerkstatt. Wiederherstellen in der Lehreransicht unter „Daten sichern“.",
		Data:    data,
	})
}

// parseBackup liest eine Sicherungsdatei (oder eine Datendatei der NetzWerkstatt) und prüft sie.
func parseBackup(b []byte) (*Store, int64, error) {
	bad := fmt.Errorf("Das ist keine Sicherungsdatei der NetzWerkstatt.")
	var head struct {
		Format   string          `json:"format"`
		Version  int             `json:"version"`
		Created  int64           `json:"created"`
		Data     json.RawMessage `json:"data"`
		Students json.RawMessage `json:"students"`
	}
	if err := json.Unmarshal(b, &head); err != nil {
		return nil, 0, bad
	}
	data := head.Data
	switch {
	case head.Format == backupFormat:
		if head.Version > backupVersion {
			return nil, 0, fmt.Errorf("Diese Sicherung stammt aus einer neueren Version der NetzWerkstatt. Bitte zuerst die NetzWerkstatt aktualisieren.")
		}
	case head.Format == "" && head.Students != nil:
		data = b // Datendatei direkt (netzwerkstatt-daten.json)
	default:
		return nil, 0, bad
	}
	tmp := &Store{}
	if err := json.Unmarshal(data, tmp); err != nil {
		return nil, 0, fmt.Errorf("Die Sicherungsdatei ist beschädigt.")
	}
	if err := tmp.check(); err != nil {
		return nil, 0, err
	}
	tmp.normalize()
	return tmp, head.Created, nil
}

// check prüft den Aufbau wiederhergestellter Daten und räumt Reste auf.
func (s *Store) check() error {
	broken := fmt.Errorf("Die Sicherungsdatei ist beschädigt.")
	if len(s.Students) > maxStudents || len(s.Classes) > maxClasses || len(s.CustomTasks) > maxCustomTasks {
		return fmt.Errorf("Die Sicherungsdatei enthält zu viele Einträge.")
	}
	classes := map[string]bool{}
	for _, c := range s.Classes {
		if c == nil || c.ID == "" || strings.TrimSpace(c.Name) == "" || classes[c.ID] {
			return broken
		}
		classes[c.ID] = true
	}
	ids, tokens := map[string]bool{}, map[string]bool{}
	kept := s.Students[:0]
	for _, st := range s.Students {
		if st == nil {
			continue
		}
		if st.ID == "" || st.Token == "" || ids[st.ID] || tokens[st.Token] || (!st.Teacher && strings.TrimSpace(st.Name) == "") {
			return broken
		}
		ids[st.ID], tokens[st.Token] = true, true
		if !classes[st.Class] {
			st.Class = "" // Klasse gibt es nicht (mehr): Schüler erscheint unter „Ohne Klasse“
		}
		kept = append(kept, st)
	}
	s.Students = kept
	for id := range s.Works {
		if !ids[id] {
			delete(s.Works, id) // Arbeiten ohne Schüler
		}
	}
	seen := map[string]bool{}
	for _, raw := range s.CustomTasks {
		id, err := customTaskID(raw)
		if err != nil || seen[id] {
			return fmt.Errorf("Eine eigene Aufgabe in der Sicherung ist ungültig.")
		}
		seen[id] = true
	}
	return nil
}

// replaceLocked übernimmt alle Daten aus from, außer Raumcode und Lehrer-Passwort.
// Aufrufer muss s.mu halten.
func (s *Store) replaceLocked(from *Store) {
	dst, src := reflect.ValueOf(s).Elem(), reflect.ValueOf(from).Elem()
	t := dst.Type()
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() || backupSkip[f.Name] {
			continue
		}
		dst.Field(i).Set(src.Field(i))
	}
	s.saveLocked()
}

func backupCounts(s *Store) map[string]int {
	n, works := 0, 0
	for _, st := range s.Students {
		if !st.Teacher {
			n++
		}
	}
	for _, w := range s.Works {
		works += len(w)
	}
	return map[string]int{"classes": len(s.Classes), "students": n, "works": works, "customTasks": len(s.CustomTasks)}
}

func (srv *Server) backupRoutes(mux *http.ServeMux) {
	s := srv.store

	mux.HandleFunc("GET /api/teacher/backup", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		s.mu.Lock()
		b, err := s.backupLocked()
		s.mu.Unlock()
		if err != nil {
			log.Println("Sicherung fehlgeschlagen:", err)
			fail(w, 500, "Die Sicherung konnte nicht erstellt werden.")
			return
		}
		name := "netzwerkstatt-sicherung-" + time.Now().Format("2006-01-02-1504") + ".json"
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(b)
	})

	// Vorschau: Was steckt in der Datei? (Noch nichts wird geändert.)
	mux.HandleFunc("POST /api/teacher/restore-check", func(w http.ResponseWriter, r *http.Request) {
		srv.restore(w, r, false)
	})

	// Wiederherstellen: ersetzt alle Daten durch die der Sicherung.
	mux.HandleFunc("POST /api/teacher/restore", func(w http.ResponseWriter, r *http.Request) {
		srv.restore(w, r, true)
	})
}

func (srv *Server) restore(w http.ResponseWriter, r *http.Request, apply bool) {
	if !srv.isTeacher(r) {
		fail(w, 401, "Bitte als Lehrkraft anmelden.")
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maxBackupSize+1))
	if err != nil {
		fail(w, 400, "Die Datei konnte nicht gelesen werden.")
		return
	}
	if len(b) > maxBackupSize {
		fail(w, 400, "Die Datei ist zu groß.")
		return
	}
	tmp, created, err := parseBackup(b)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	counts := backupCounts(tmp)
	if !apply {
		writeJSON(w, 200, map[string]any{"ok": true, "counts": counts, "created": created})
		return
	}
	s := srv.store
	s.mu.Lock()
	// Vorher den bisherigen Stand neben die Datendatei legen, falls die falsche Datei erwischt wurde.
	cur, err := json.Marshal(s)
	copyName := ""
	if err == nil {
		base := strings.TrimSuffix(s.path, filepath.Ext(s.path))
		copyPath := base + "-vor-wiederherstellung-" + time.Now().Format("2006-01-02-150405") + ".json"
		err = os.WriteFile(copyPath, cur, 0o600)
		copyName = filepath.Base(copyPath)
	}
	if err != nil {
		s.mu.Unlock()
		log.Println("Kopie vor dem Wiederherstellen fehlgeschlagen:", err)
		fail(w, 500, "Der bisherige Stand konnte nicht gesichert werden. Es wurde nichts verändert.")
		return
	}
	s.replaceLocked(tmp)
	s.mu.Unlock()
	s.flush()
	srv.tmu.Lock()
	srv.codeFails = map[string]*codeFail{}
	srv.tmu.Unlock()
	log.Println("Daten aus einer Sicherung wiederhergestellt. Der vorherige Stand liegt in", copyName)
	writeJSON(w, 200, map[string]any{"ok": true, "counts": counts, "copy": copyName})
}
