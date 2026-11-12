// NetzWerkstatt – Server für das Netzwerk-Lernspiel.
//
// Das Programm wird auf dem Lehrer-Rechner gestartet (Doppelklick genügt).
// Schülerinnen und Schüler öffnen die angezeigte Adresse im Browser.
// Alle Daten bleiben in einer Datei neben dem Programm; es wird nichts aus
// dem Internet geladen oder dorthin gesendet.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFiles embed.FS

// ---------------------------------------------------------------- Daten

type Student struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Token   string `json:"token"`
	Created int64  `json:"created"`
	// Teacher markiert den Baukasten-Zugang der Lehrkraft: Er sieht alle Aufgaben
	// und taucht nicht in der Schülerliste auf.
	Teacher bool `json:"teacher,omitempty"`
	// CodeHash ist der Prüfwert des vierstelligen Schüler-Codes. Leer heißt:
	// Noch kein Code (oder von der Lehrkraft zurückgesetzt) – der nächste
	// eingegebene Code wird übernommen.
	CodeHash string `json:"codeHash,omitempty"`
	// Class ist die ID der Klasse, in der sich der Schüler angemeldet hat (leer = ohne Klasse).
	Class string `json:"class,omitempty"`
}

// Class ist eine Klasse der Lehrkraft. Neue Schüler landen in der aktiven Klasse.
type Class struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

const maxClasses = 60

var codeRe = regexp.MustCompile(`^[0-9]{4}$`)

func codeHash(st *Student, code string) string {
	h := sha256.Sum256([]byte("netzwerkstatt:" + st.ID + ":" + code))
	return hex.EncodeToString(h[:])
}

func (st *Student) codeOK(code string) bool {
	return subtle.ConstantTimeCompare([]byte(st.CodeHash), []byte(codeHash(st, code))) == 1
}

type Work struct {
	Network   json.RawMessage `json:"network"`
	Submitted bool            `json:"submitted"`
	Updated   int64           `json:"updated"`
}

type Store struct {
	RoomCode        string                     `json:"roomCode"`
	TeacherPassword string                     `json:"teacherPassword"`
	Students        []*Student                 `json:"students"`
	Works           map[string]map[string]Work `json:"works"`    // studentID -> taskID -> Arbeit
	Released        map[string]bool            `json:"released"` // taskID -> Musterlösung freigegeben
	Unlocked        map[string]bool            `json:"unlocked"` // taskID -> für Schüler freigeschaltet
	CustomTasks     []json.RawMessage          `json:"customTasks"`
	Demos           map[string]bool            `json:"demos"` // demoID -> Vorführung für Schüler freigegeben
	Classes         []*Class                   `json:"classes"`
	ActiveClass     string                     `json:"activeClass"` // ID der aktiven Klasse ("" = keine Klassen angelegt)

	mu   sync.Mutex
	path string
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func randomDigits(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		d, _ := rand.Int(rand.Reader, big.NewInt(10))
		s += d.String()
	}
	return s
}

func randomWord() string {
	words := []string{"router", "switch", "paket", "kabel", "server", "client", "bitrate", "subnetz", "gateway", "domain"}
	i, _ := rand.Int(rand.Reader, big.NewInt(int64(len(words))))
	return words[i.Int64()] + randomDigits(2)
}

func loadStore(path string) *Store {
	s := &Store{path: path}
	if b, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(b, s); err != nil {
			// Beschädigte Datei sichern und neu beginnen, statt abzubrechen.
			backup := path + ".defekt-" + time.Now().Format("2006-01-02-150405")
			_ = os.Rename(path, backup)
			warn("Die Datendatei war beschädigt und wurde gesichert als:\n      " + backup + "\n    Es wird mit einer leeren Datei weitergemacht.")
			*s = Store{path: path}
		}
	}
	if s.RoomCode == "" {
		s.RoomCode = randomDigits(4)
	}
	if s.TeacherPassword == "" {
		s.TeacherPassword = randomWord()
	}
	if s.Works == nil {
		s.Works = map[string]map[string]Work{}
	}
	if s.Released == nil {
		s.Released = map[string]bool{}
	}
	if s.Demos == nil {
		s.Demos = map[string]bool{} // ab Werk sind keine Vorführungen freigegeben
	}
	if s.Unlocked == nil {
		// Ab Werk (und bei Dateien aus älteren Versionen) sind diese Aufgaben freigeschaltet.
		s.Unlocked = map[string]bool{}
		for _, id := range defaultUnlocked {
			s.Unlocked[id] = true
		}
	}
	if s.CustomTasks == nil {
		s.CustomTasks = []json.RawMessage{}
	}
	if s.Classes == nil {
		s.Classes = []*Class{}
	}
	if s.classByID(s.ActiveClass) == nil {
		s.ActiveClass = ""
		if len(s.Classes) > 0 {
			s.ActiveClass = s.Classes[0].ID
		}
	}
	s.saveLocked()
	return s
}

// saveLocked schreibt die Daten atomar. Aufrufer muss s.mu halten (oder beim Start).
func (s *Store) saveLocked() {
	b, err := json.MarshalIndent(s, "", " ")
	if err != nil {
		log.Println("Speichern fehlgeschlagen:", err)
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Println("Speichern fehlgeschlagen:", err)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		log.Println("Speichern fehlgeschlagen:", err)
	}
}

// defaultUnlocked: Aufgaben, die ab Werk für Schüler freigeschaltet sind.
var defaultUnlocked = []string{"zwei-pcs", "stern", "heimnetz", "webseite", "dhcp", "frei"}

// Grenzen für eigene Aufgaben (die genaue Prüfung macht die Oberfläche in eigene.js).
const (
	maxCustomTasks    = 60
	maxCustomTaskSize = 1 << 20
)

var customIDPattern = regexp.MustCompile(`^eigen-[a-z0-9-]{1,30}$`)

// customTaskID liest die ID einer eigenen Aufgabe und prüft den groben Aufbau.
func customTaskID(raw json.RawMessage) (string, error) {
	var t struct {
		ID    string          `json:"id"`
		Title string          `json:"title"`
		Goals json.RawMessage `json:"goals"`
	}
	if len(raw) > maxCustomTaskSize {
		return "", fmt.Errorf("Die Aufgabe ist zu groß.")
	}
	if err := json.Unmarshal(raw, &t); err != nil {
		return "", fmt.Errorf("Die Aufgabe ist ungültig.")
	}
	if !customIDPattern.MatchString(t.ID) || strings.TrimSpace(t.Title) == "" || len(t.Title) > 200 {
		return "", fmt.Errorf("Die Aufgabe ist ungültig.")
	}
	var goals []json.RawMessage
	if err := json.Unmarshal(t.Goals, &goals); err != nil {
		return "", fmt.Errorf("Die Ziele der Aufgabe sind ungültig.")
	}
	return t.ID, nil
}

// customForStudents liefert eigene Aufgaben ohne Musterlösung, außer sie ist freigegeben.
// Aufrufer muss s.mu halten.
func (s *Store) customForStudents(all bool) []json.RawMessage {
	out := []json.RawMessage{}
	for _, raw := range s.CustomTasks {
		id, err := customTaskID(raw)
		if err != nil || (!all && !s.Unlocked[id]) {
			continue
		}
		if !s.Released[id] {
			var m map[string]json.RawMessage
			if json.Unmarshal(raw, &m) != nil {
				continue
			}
			delete(m, "solution")
			b, _ := json.Marshal(m)
			raw = b
		}
		out = append(out, raw)
	}
	return out
}

// openDemos: freigegebene Vorführungen (nur IDs mit true). Aufruf mit gehaltener Sperre.
func (s *Store) openDemos() map[string]bool {
	open := map[string]bool{}
	for id, on := range s.Demos {
		if on {
			open[id] = true
		}
	}
	return open
}

func (s *Store) classByID(id string) *Class {
	if id == "" {
		return nil
	}
	for _, c := range s.Classes {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// className liefert den Namen der Klasse eines Schülers ("" = ohne Klasse).
func (s *Store) className(id string) string {
	if c := s.classByID(id); c != nil {
		return c.Name
	}
	return ""
}

// inActiveClass: Darf dieser Schüler gerade arbeiten? Sind Klassen angelegt, nur die
// Schüler der aktiven Klasse. So arbeitet an einem geteilten Rechner niemand aus
// Versehen im Konto eines Schülers aus einer anderen Klasse weiter.
func (s *Store) inActiveClass(st *Student) bool {
	return st.Teacher || len(s.Classes) == 0 || st.Class == s.ActiveClass
}

// studentByToken findet den angemeldeten Schüler; Schüler aus nicht aktiven Klassen
// gelten als abgemeldet. Aufrufer muss s.mu halten.
func (s *Store) studentByToken(tok string) *Student {
	if tok == "" {
		return nil
	}
	for _, st := range s.Students {
		if st.Token == tok {
			if !s.inActiveClass(st) {
				return nil
			}
			return st
		}
	}
	return nil
}

// normClassName kürzt und bereinigt einen Klassennamen.
func normClassName(n string) string {
	n = strings.Join(strings.Fields(n), " ")
	if len([]rune(n)) > 20 {
		n = string([]rune(n)[:20])
	}
	return n
}

// classNameTaken prüft, ob es den Namen schon gibt (außer bei der Klasse except).
func (s *Store) classNameTaken(name, except string) bool {
	for _, c := range s.Classes {
		if c.ID != except && strings.EqualFold(c.Name, name) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- HTTP-Helfer

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readBody(r *http.Request, v any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func bearer(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}

// ---------------------------------------------------------------- Server

type Server struct {
	port          int
	store         *Store
	teacherTokens map[string]time.Time
	tmu           sync.Mutex
	// Fehlversuche beim Schüler-Code (Schüler-ID -> Anzahl, Sperre bis)
	codeFails map[string]*codeFail
}

type codeFail struct {
	n     int
	until time.Time
}

const maxCodeFails = 5
const codeLockTime = time.Minute

func (srv *Server) isTeacher(r *http.Request) bool {
	srv.tmu.Lock()
	defer srv.tmu.Unlock()
	_, ok := srv.teacherTokens[bearer(r)]
	return ok
}

// codeLocked sagt, wie lange ein Schülerkonto nach zu vielen falschen Codes noch gesperrt ist.
func (srv *Server) codeLocked(id string) time.Duration {
	srv.tmu.Lock()
	defer srv.tmu.Unlock()
	if f := srv.codeFails[id]; f != nil {
		return time.Until(f.until)
	}
	return 0
}

func (srv *Server) addCodeFail(id string) {
	srv.tmu.Lock()
	defer srv.tmu.Unlock()
	f := srv.codeFails[id]
	if f == nil {
		f = &codeFail{}
		srv.codeFails[id] = f
	}
	f.n++
	if f.n >= maxCodeFails {
		f.n = 0
		f.until = time.Now().Add(codeLockTime)
	}
}

func (srv *Server) clearCodeFails(id string) {
	srv.tmu.Lock()
	defer srv.tmu.Unlock()
	delete(srv.codeFails, id)
}

func normName(n string) string {
	n = strings.TrimSpace(n)
	n = strings.Join(strings.Fields(n), " ")
	if len([]rune(n)) > 30 {
		n = string([]rune(n)[:30])
	}
	return n
}

func (srv *Server) routes() http.Handler {
	mux := http.NewServeMux()
	s := srv.store

	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"app": "NetzWerkstatt", "version": Version})
	})

	// Schüler-Anmeldung: Name + Raumcode + eigener vierstelliger Code
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Name, Room, Code string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		name := normName(req.Name)
		if name == "" {
			fail(w, 400, "Bitte gib deinen Namen ein.")
			return
		}
		code := strings.TrimSpace(req.Code)
		if !codeRe.MatchString(code) {
			fail(w, 400, "Dein Code muss genau 4 Ziffern haben, z. B. 4711.")
			return
		}
		s.mu.Lock()
		if strings.TrimSpace(req.Room) != s.RoomCode {
			s.mu.Unlock()
			fail(w, 403, "Der Raumcode stimmt nicht. Schau an die Tafel oder frag deine Lehrkraft.")
			return
		}
		for _, st := range s.Students {
			// Namen gelten je Klasse: „Lena“ in der 10a und „Lena“ in der 10b sind zwei Schülerinnen.
			if st.Teacher || st.Class != s.ActiveClass || !strings.EqualFold(st.Name, name) {
				continue
			}
			if st.CodeHash == "" {
				// erster Code für einen alten Eintrag oder nach dem Zurücksetzen
				st.CodeHash = codeHash(st, code)
				s.saveLocked()
				s.mu.Unlock()
				srv.clearCodeFails(st.ID)
				writeJSON(w, 200, map[string]any{"token": st.Token, "name": st.Name, "returning": true, "newCode": true})
				return
			}
			if wait := srv.codeLocked(st.ID); wait > 0 {
				s.mu.Unlock()
				fail(w, 429, fmt.Sprintf("Zu viele falsche Versuche. Warte %d Sekunden oder frag deine Lehrkraft.", int(wait.Seconds())+1))
				return
			}
			ok := st.codeOK(code)
			id, tok, n := st.ID, st.Token, st.Name
			s.mu.Unlock()
			if !ok {
				srv.addCodeFail(id)
				time.Sleep(700 * time.Millisecond)
				fail(w, 403, "Diesen Namen gibt es schon, aber der Code passt nicht. Hast du dich vertippt? Wenn du deinen Code vergessen hast, kann deine Lehrkraft ihn zurücksetzen. Bist du neu, nimm einen anderen Namen oder hänge einen Buchstaben an (z. B. „Lena M.“).")
				return
			}
			srv.clearCodeFails(id)
			writeJSON(w, 200, map[string]any{"token": tok, "name": n, "returning": true})
			return
		}
		st := &Student{ID: randomToken(6), Name: name, Token: randomToken(16), Created: time.Now().Unix(), Class: s.ActiveClass}
		st.CodeHash = codeHash(st, code)
		s.Students = append(s.Students, st)
		s.saveLocked()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"token": st.Token, "name": st.Name, "newCode": true})
	})

	// Eigener Stand: Name, Arbeiten (nur Status), freigegebene Lösungen
	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		st := s.studentByToken(bearer(r))
		if st == nil {
			fail(w, 401, "Bitte melde dich an.")
			return
		}
		status := map[string]map[string]any{}
		for tid, wk := range s.Works[st.ID] {
			status[tid] = map[string]any{"submitted": wk.Submitted, "updated": wk.Updated}
		}
		unlocked := map[string]bool{}
		for id, on := range s.Unlocked {
			if on {
				unlocked[id] = true
			}
		}
		writeJSON(w, 200, map[string]any{"name": st.Name, "className": s.className(st.Class), "works": status, "released": s.Released,
			"unlocked": unlocked, "preview": st.Teacher, "customTasks": s.customForStudents(st.Teacher),
			"demos": s.openDemos(), "allDemos": st.Teacher})
	})

	// Vorführungen: Die Lehrkraft sieht alle, Schüler nur die freigegebenen
	mux.HandleFunc("GET /api/demos", func(w http.ResponseWriter, r *http.Request) {
		if srv.isTeacher(r) {
			s.mu.Lock()
			defer s.mu.Unlock()
			writeJSON(w, 200, map[string]any{"teacher": true, "open": s.openDemos()})
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		st := s.studentByToken(bearer(r))
		if st == nil {
			fail(w, 401, "Bitte melde dich an.")
			return
		}
		writeJSON(w, 200, map[string]any{"teacher": false, "all": st.Teacher, "open": s.openDemos()})
	})

	mux.HandleFunc("GET /api/work/{task}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		st := s.studentByToken(bearer(r))
		if st == nil {
			fail(w, 401, "Bitte melde dich an.")
			return
		}
		wk, ok := s.Works[st.ID][r.PathValue("task")]
		if !ok {
			writeJSON(w, 200, map[string]any{"network": nil})
			return
		}
		writeJSON(w, 200, wk)
	})

	mux.HandleFunc("PUT /api/work/{task}", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Network   json.RawMessage `json:"network"`
			Submitted *bool           `json:"submitted"`
		}
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		st := s.studentByToken(bearer(r))
		if st == nil {
			fail(w, 401, "Bitte melde dich an.")
			return
		}
		task := r.PathValue("task")
		if len(task) > 40 {
			fail(w, 400, "Ungültige Aufgabe.")
			return
		}
		if s.Works[st.ID] == nil {
			s.Works[st.ID] = map[string]Work{}
		}
		wk := s.Works[st.ID][task]
		if len(req.Network) > 0 {
			wk.Network = req.Network
		}
		if req.Submitted != nil {
			wk.Submitted = *req.Submitted
		}
		wk.Updated = time.Now().Unix()
		s.Works[st.ID][task] = wk
		s.saveLocked()
		writeJSON(w, 200, map[string]any{"ok": true, "submitted": wk.Submitted})
	})

	// ------------------------------------------------ Lehrkraft

	mux.HandleFunc("POST /api/teacher/login", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Password string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		ok := strings.TrimSpace(req.Password) == s.TeacherPassword
		s.mu.Unlock()
		if !ok {
			time.Sleep(700 * time.Millisecond)
			fail(w, 403, "Falsches Passwort. Es steht im Fenster des NetzWerkstatt-Servers.")
			return
		}
		tok := randomToken(16)
		srv.tmu.Lock()
		srv.teacherTokens[tok] = time.Now()
		srv.tmu.Unlock()
		writeJSON(w, 200, map[string]string{"token": tok})
	})

	mux.HandleFunc("GET /api/teacher/overview", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		type row struct {
			ID      string          `json:"id"`
			Name    string          `json:"name"`
			Works   map[string]Work `json:"works"`
			HasCode bool            `json:"hasCode"`
			Class   string          `json:"class"`
		}
		rows := []row{}
		var own map[string]Work
		for _, st := range s.Students {
			if st.Teacher {
				own = s.Works[st.ID]
				continue
			}
			rows = append(rows, row{ID: st.ID, Name: st.Name, Works: s.Works[st.ID], HasCode: st.CodeHash != "", Class: st.Class})
		}
		sort.Slice(rows, func(i, j int) bool { return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name) })
		addrs := []string{}
		for _, ip := range localIPs() {
			addrs = append(addrs, fmt.Sprintf("http://%s:%d", ip, srv.port))
		}
		writeJSON(w, 200, map[string]any{"students": rows, "released": s.Released, "roomCode": s.RoomCode, "addresses": addrs,
			"unlocked": s.Unlocked, "customTasks": s.CustomTasks, "ownWorks": own,
			"classes": s.Classes, "activeClass": s.ActiveClass})
	})

	// ------------------------------------------------ Klassen

	// Neue Klasse anlegen. Die erste Klasse wird gleich aktiv; Schüler, die schon ohne
	// Klasse angemeldet sind, kommen dabei in diese Klasse.
	mux.HandleFunc("POST /api/teacher/class-add", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ Name string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		name := normClassName(req.Name)
		if name == "" {
			fail(w, 400, "Bitte gib einen Namen für die Klasse ein, z. B. „10a“.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.classNameTaken(name, "") {
			fail(w, 400, "Eine Klasse mit diesem Namen gibt es schon.")
			return
		}
		if len(s.Classes) >= maxClasses {
			fail(w, 400, fmt.Sprintf("Es sind höchstens %d Klassen möglich.", maxClasses))
			return
		}
		c := &Class{ID: randomToken(4), Name: name}
		s.Classes = append(s.Classes, c)
		if s.ActiveClass == "" {
			s.ActiveClass = c.ID
			for _, st := range s.Students {
				if !st.Teacher && st.Class == "" {
					st.Class = c.ID
				}
			}
		}
		s.saveLocked()
		writeJSON(w, 200, map[string]any{"ok": true, "id": c.ID, "active": s.ActiveClass == c.ID})
	})

	mux.HandleFunc("POST /api/teacher/class-rename", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ ID, Name string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		name := normClassName(req.Name)
		if name == "" {
			fail(w, 400, "Bitte gib einen Namen für die Klasse ein.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		c := s.classByID(req.ID)
		if c == nil {
			fail(w, 404, "Diese Klasse gibt es nicht mehr.")
			return
		}
		if s.classNameTaken(name, c.ID) {
			fail(w, 400, "Eine Klasse mit diesem Namen gibt es schon.")
			return
		}
		c.Name = name
		s.saveLocked()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Klasse aktiv schalten: Neue Anmeldungen landen in dieser Klasse, Schüler anderer
	// Klassen werden abgemeldet (ihre Arbeiten bleiben erhalten).
	mux.HandleFunc("POST /api/teacher/class-activate", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ ID string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.classByID(req.ID) == nil {
			fail(w, 404, "Diese Klasse gibt es nicht mehr.")
			return
		}
		s.ActiveClass = req.ID
		s.saveLocked()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Klasse löschen – mit allen ihren Schülern und deren Arbeiten.
	mux.HandleFunc("POST /api/teacher/class-delete", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ ID string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.classByID(req.ID) == nil {
			fail(w, 404, "Diese Klasse gibt es nicht mehr.")
			return
		}
		keptC := []*Class{}
		for _, c := range s.Classes {
			if c.ID != req.ID {
				keptC = append(keptC, c)
			}
		}
		s.Classes = keptC
		keptS := []*Student{}
		for _, st := range s.Students {
			if !st.Teacher && st.Class == req.ID {
				delete(s.Works, st.ID)
				continue
			}
			keptS = append(keptS, st)
		}
		s.Students = keptS
		if s.ActiveClass == req.ID {
			s.ActiveClass = ""
			if len(s.Classes) > 0 {
				s.ActiveClass = s.Classes[0].ID
			}
		}
		s.saveLocked()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Schüler in eine andere Klasse verschieben (z. B. wenn die falsche Klasse aktiv war).
	mux.HandleFunc("POST /api/teacher/move-student", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ Student, Class string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		c := s.classByID(req.Class)
		if c == nil {
			fail(w, 404, "Diese Klasse gibt es nicht mehr.")
			return
		}
		var st *Student
		for _, x := range s.Students {
			if x.ID == req.Student && !x.Teacher {
				st = x
			}
		}
		if st == nil {
			fail(w, 404, "Diese Schülerin oder diesen Schüler gibt es nicht mehr.")
			return
		}
		for _, x := range s.Students {
			if x != st && !x.Teacher && x.Class == c.ID && strings.EqualFold(x.Name, st.Name) {
				fail(w, 400, fmt.Sprintf("In der Klasse %s gibt es schon jemanden mit dem Namen „%s“.", c.Name, st.Name))
				return
			}
		}
		st.Class = c.ID
		s.saveLocked()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Aufgaben für Schüler freischalten oder sperren (einzeln oder ein ganzes Thema)
	mux.HandleFunc("POST /api/teacher/unlock", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct {
			Tasks    []string `json:"tasks"`
			Unlocked bool     `json:"unlocked"`
		}
		if err := readBody(r, &req); err != nil || len(req.Tasks) == 0 || len(req.Tasks) > 200 {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		for _, id := range req.Tasks {
			if id != "" && len(id) <= 40 {
				s.Unlocked[id] = req.Unlocked
			}
		}
		s.saveLocked()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Vorführungen für Schüler freigeben oder sperren (einzeln oder alle)
	mux.HandleFunc("POST /api/teacher/demos", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct {
			Demos []string `json:"demos"`
			Open  bool     `json:"open"`
		}
		if err := readBody(r, &req); err != nil || len(req.Demos) == 0 || len(req.Demos) > 100 {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		for _, id := range req.Demos {
			if id != "" && len(id) <= 40 {
				if req.Open {
					s.Demos[id] = true
				} else {
					delete(s.Demos, id)
				}
			}
		}
		s.saveLocked()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Eigene Aufgabe anlegen oder ersetzen (gleiche ID)
	mux.HandleFunc("POST /api/teacher/custom", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct {
			Task json.RawMessage `json:"task"`
		}
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		id, err := customTaskID(req.Task)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		for i, raw := range s.CustomTasks {
			if old, _ := customTaskID(raw); old == id {
				s.CustomTasks[i] = req.Task
				s.saveLocked()
				writeJSON(w, 200, map[string]any{"ok": true, "id": id})
				return
			}
		}
		if len(s.CustomTasks) >= maxCustomTasks {
			fail(w, 400, fmt.Sprintf("Es sind höchstens %d eigene Aufgaben möglich.", maxCustomTasks))
			return
		}
		s.CustomTasks = append(s.CustomTasks, req.Task)
		s.saveLocked()
		writeJSON(w, 200, map[string]any{"ok": true, "id": id})
	})

	mux.HandleFunc("POST /api/teacher/custom-delete", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ ID string }
		if err := readBody(r, &req); err != nil || req.ID == "" {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		kept := s.CustomTasks[:0]
		for _, raw := range s.CustomTasks {
			if id, _ := customTaskID(raw); id != req.ID {
				kept = append(kept, raw)
			}
		}
		s.CustomTasks = kept
		delete(s.Unlocked, req.ID)
		delete(s.Released, req.ID)
		for _, works := range s.Works {
			delete(works, req.ID)
		}
		s.saveLocked()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Baukasten-Zugang der Lehrkraft: Damit kann sie Aufbauten für eigene Aufgaben
	// bauen und alle Aufgaben ausprobieren, auch gesperrte.
	mux.HandleFunc("POST /api/teacher/workshop", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, st := range s.Students {
			if st.Teacher {
				writeJSON(w, 200, map[string]string{"token": st.Token})
				return
			}
		}
		st := &Student{ID: randomToken(6), Name: "Lehrkraft", Token: randomToken(16), Created: time.Now().Unix(), Teacher: true}
		s.Students = append(s.Students, st)
		s.saveLocked()
		writeJSON(w, 200, map[string]string{"token": st.Token})
	})

	mux.HandleFunc("POST /api/teacher/release", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct {
			Task     string `json:"task"`
			Released bool   `json:"released"`
		}
		if err := readBody(r, &req); err != nil || req.Task == "" {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		s.Released[req.Task] = req.Released
		s.saveLocked()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	mux.HandleFunc("POST /api/teacher/return", func(w http.ResponseWriter, r *http.Request) {
		// Abgabe zurückgeben, damit weitergearbeitet werden kann
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ Student, Task string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		if wk, ok := s.Works[req.Student][req.Task]; ok {
			wk.Submitted = false
			s.Works[req.Student][req.Task] = wk
			s.saveLocked()
		}
		s.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Vergessenen Schüler-Code zurücksetzen: Beim nächsten Anmelden gilt der neu eingegebene Code.
	mux.HandleFunc("POST /api/teacher/reset-code", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ Student string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		found := false
		for _, st := range s.Students {
			if st.ID == req.Student && !st.Teacher {
				st.CodeHash = ""
				found = true
			}
		}
		if found {
			s.saveLocked()
		}
		s.mu.Unlock()
		if !found {
			fail(w, 404, "Diese Schülerin oder diesen Schüler gibt es nicht mehr.")
			return
		}
		srv.clearCodeFails(req.Student)
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// Arbeiten löschen: einzeln oder viele auf einmal. Jeder Eintrag nennt Schüler/in und Aufgabe;
	// so lassen sich auch alle Arbeiten einer Aufgabe oder einer Gruppe in einem Schritt löschen.
	mux.HandleFunc("POST /api/teacher/delete-works", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct {
			Items []struct{ Student, Task string } `json:"items"`
		}
		if err := readBody(r, &req); err != nil || len(req.Items) == 0 || len(req.Items) > 20000 {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		n := 0
		for _, it := range req.Items {
			works := s.Works[it.Student]
			if _, ok := works[it.Task]; ok {
				delete(works, it.Task)
				n++
			}
		}
		if n > 0 {
			s.saveLocked()
		}
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true, "deleted": n})
	})

	mux.HandleFunc("POST /api/teacher/delete-student", func(w http.ResponseWriter, r *http.Request) {
		if !srv.isTeacher(r) {
			fail(w, 401, "Bitte als Lehrkraft anmelden.")
			return
		}
		var req struct{ Student string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		s.mu.Lock()
		kept := s.Students[:0]
		for _, st := range s.Students {
			if st.ID != req.Student {
				kept = append(kept, st)
			}
		}
		s.Students = kept
		delete(s.Works, req.Student)
		s.saveLocked()
		s.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// ------------------------------------------------ statische Dateien
	sub, _ := fs.Sub(webFiles, "web")
	files := http.FileServer(http.FS(sub))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/lehrer" || r.URL.Path == "/lehrer/" {
			r.URL.Path = "/lehrer.html"
		}
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	return securityHeaders(mux)
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Nichts von außen laden: nur eigene Quelle erlaubt.
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		h.ServeHTTP(w, r)
	})
}

// virtualAdapter erkennt typische virtuelle Netzwerkadapter (VirtualBox, VMware,
// Hyper-V, WSL, Docker …), über die Schülergeräte die NetzWerkstatt nicht erreichen.
func virtualAdapter(name string) bool {
	n := strings.ToLower(name)
	for _, k := range []string{"virtualbox", "vbox", "vmware", "vmnet", "hyper-v", "vethernet", "wsl", "docker", "veth", "br-", "virbr", "tailscale", "zerotier", "tun", "tap", "vpn", "loopback", "bluetooth"} {
		if strings.Contains(n, k) {
			return true
		}
	}
	return false
}

// outboundIP liefert die Adresse, über die dieser Rechner standardmäßig ins Netz geht.
// Es wird dabei nichts gesendet: Bei UDP legt Dial nur die Route fest.
func outboundIP() net.IP {
	c, err := net.Dial("udp4", "192.0.2.1:9")
	if err != nil {
		return nil
	}
	defer c.Close()
	if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.To4()
	}
	return nil
}

// localIPs liefert die IPv4-Adressen dieses Rechners; die wahrscheinlich richtige
// Schulnetz-Adresse steht vorne, Adressen virtueller Adapter hinten.
func localIPs() []string {
	var real, virtual []string
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 == nil || ip4.IsLinkLocalUnicast() {
				continue
			}
			if virtualAdapter(ifc.Name) {
				virtual = append(virtual, ip4.String())
			} else {
				real = append(real, ip4.String())
			}
		}
	}
	all := append(real, virtual...)
	if ob := outboundIP(); ob != nil {
		for i, ip := range all {
			if ip == ob.String() {
				all = append([]string{ip}, append(all[:i:i], all[i+1:]...)...)
				break
			}
		}
	}
	return all
}
