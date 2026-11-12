package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// testServer startet einen Server mit leerer Datendatei und angemeldeter Lehrkraft.
func testServer(t *testing.T) (*Server, http.Handler, string) {
	t.Helper()
	st := loadStore(filepath.Join(t.TempDir(), "daten.json"))
	srv := &Server{port: 8080, store: st, teacherTokens: map[string]time.Time{"lehrer": time.Now()}, codeFails: map[string]*codeFail{}}
	return srv, srv.routes(), "lehrer"
}

func call(t *testing.T, h http.Handler, method, url, token string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, url, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func login(t *testing.T, h http.Handler, room, name, code string) (int, map[string]any) {
	return call(t, h, "POST", "/api/login", "", map[string]string{"name": name, "room": room, "code": code})
}

func TestKlassenAktivSchalten(t *testing.T) {
	srv, h, teacher := testServer(t)
	room := srv.store.RoomCode

	// Ohne Klassen geht alles wie bisher.
	code, r := login(t, h, room, "Alt", "1111")
	if code != 200 {
		t.Fatalf("Anmeldung ohne Klassen: %d %v", code, r)
	}
	altToken := r["token"].(string)

	// Erste Klasse: wird aktiv und übernimmt die bisher angemeldeten Schüler.
	code, r = call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": " 10a "})
	if code != 200 || r["active"] != true {
		t.Fatalf("Klasse anlegen: %d %v", code, r)
	}
	idA := r["id"].(string)
	if srv.store.Students[0].Class != idA {
		t.Fatalf("Alter Schüler sollte in der ersten Klasse sein")
	}
	if code, _ = call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": "10A"}); code != 400 {
		t.Fatalf("Doppelter Klassenname sollte abgelehnt werden: %d", code)
	}
	_, r = call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": "10b"})
	idB := r["id"].(string)
	if srv.store.ActiveClass != idA {
		t.Fatalf("Zweite Klasse darf nicht von selbst aktiv werden")
	}

	// Anmeldung landet in der aktiven Klasse.
	_, r = login(t, h, room, "Lena", "1234")
	lenaA := r["token"].(string)
	code, me := call(t, h, "GET", "/api/me", lenaA, nil)
	if code != 200 || me["className"] != "10a" {
		t.Fatalf("/api/me in 10a: %d %v", code, me)
	}

	// 10b aktiv: Schüler der 10a gelten als abgemeldet, gleiche Namen sind neue Schüler.
	if code, _ = call(t, h, "POST", "/api/teacher/class-activate", teacher, map[string]string{"id": idB}); code != 200 {
		t.Fatalf("Aktiv schalten: %d", code)
	}
	if code, _ = call(t, h, "GET", "/api/me", lenaA, nil); code != 401 {
		t.Fatalf("Schüler der nicht aktiven Klasse sollte abgemeldet sein: %d", code)
	}
	if code, _ = call(t, h, "PUT", "/api/work/stern", altToken, map[string]any{"network": map[string]any{}}); code != 401 {
		t.Fatalf("Speichern aus nicht aktiver Klasse sollte abgelehnt werden: %d", code)
	}
	code, r = login(t, h, room, "Lena", "9999")
	if code != 200 || r["returning"] == true {
		t.Fatalf("Lena in 10b sollte neu sein: %d %v", code, r)
	}
	lenaB := r["token"].(string)
	code, me = call(t, h, "GET", "/api/me", lenaB, nil)
	if code != 200 || me["className"] != "10b" {
		t.Fatalf("/api/me in 10b: %d %v", code, me)
	}

	// Übersicht enthält Klassen und die Klasse jedes Schülers.
	_, ov := call(t, h, "GET", "/api/teacher/overview", teacher, nil)
	if ov["activeClass"] != idB || len(ov["classes"].([]any)) != 2 || len(ov["students"].([]any)) != 3 {
		t.Fatalf("Übersicht: %v", ov)
	}

	// Verschieben: Lena aus 10b kann nicht in die 10a, dort gibt es schon eine Lena.
	var lenaBID string
	for _, st := range srv.store.Students {
		if st.Token == lenaB {
			lenaBID = st.ID
		}
	}
	if code, _ = call(t, h, "POST", "/api/teacher/move-student", teacher, map[string]string{"student": lenaBID, "class": idA}); code != 400 {
		t.Fatalf("Verschieben mit doppeltem Namen sollte abgelehnt werden: %d", code)
	}

	// Umbenennen
	if code, _ = call(t, h, "POST", "/api/teacher/class-rename", teacher, map[string]string{"id": idB, "name": "10b Info"}); code != 200 || srv.store.Classes[1].Name != "10b Info" {
		t.Fatalf("Umbenennen: %d", code)
	}

	// Aktive Klasse löschen: ihre Schüler und Arbeiten verschwinden, die andere wird aktiv.
	if code, _ = call(t, h, "POST", "/api/teacher/class-delete", teacher, map[string]string{"id": idB}); code != 200 {
		t.Fatalf("Löschen: %d", code)
	}
	if srv.store.ActiveClass != idA || len(srv.store.Students) != 2 || len(srv.store.Classes) != 1 {
		t.Fatalf("Nach dem Löschen: aktiv=%s Schüler=%d Klassen=%d", srv.store.ActiveClass, len(srv.store.Students), len(srv.store.Classes))
	}
	if code, _ = call(t, h, "GET", "/api/me", lenaA, nil); code != 200 {
		t.Fatalf("Lena aus 10a sollte wieder arbeiten können: %d", code)
	}

	// Ohne Lehrer-Anmeldung geht nichts.
	if code, _ = call(t, h, "POST", "/api/teacher/class-add", "", map[string]string{"name": "x"}); code != 401 {
		t.Fatalf("Ohne Lehrkraft: %d", code)
	}
}

func TestKlassenBleibenNachNeustart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daten.json")
	st := loadStore(path)
	st.Classes = []*Class{{ID: "a1", Name: "10a"}}
	st.ActiveClass = "weg"
	st.saveLocked()
	st2 := loadStore(path)
	if st2.ActiveClass != "a1" {
		t.Fatalf("Ungültige aktive Klasse sollte auf die erste Klasse fallen, ist %q", st2.ActiveClass)
	}
}

func TestSchuelerGesammeltLoeschen(t *testing.T) {
	srv, h, teacher := testServer(t)
	room := srv.store.RoomCode
	ids := []string{}
	for _, n := range []string{"Anna", "Ben", "Cem"} {
		code, r := login(t, h, room, n, "1234")
		if code != 200 {
			t.Fatalf("Anmeldung %s: %d %v", n, code, r)
		}
		tok := r["token"].(string)
		for _, task := range []string{"zwei-pcs", "stern"} {
			if c, _ := call(t, h, "PUT", "/api/work/"+task, tok, map[string]any{"network": map[string]any{"devices": []any{}}}); c != 200 {
				t.Fatalf("Arbeit speichern: %d", c)
			}
		}
		ids = append(ids, srv.store.Students[len(srv.store.Students)-1].ID)
	}
	// Lehrkraft-Baukasten darf nicht mitgelöscht werden
	call(t, h, "POST", "/api/teacher/workshop", teacher, nil)

	if c, _ := call(t, h, "POST", "/api/teacher/delete-students", "", map[string]any{"students": ids}); c != 401 {
		t.Fatalf("ohne Anmeldung: %d", c)
	}

	// Nur Arbeiten: Anmeldungen bleiben, alle Aufgaben sind leer
	c, r := call(t, h, "POST", "/api/teacher/delete-students", teacher, map[string]any{"students": ids[:2], "worksOnly": true})
	if c != 200 || r["works"].(float64) != 4 || r["students"].(float64) != 2 {
		t.Fatalf("Arbeiten löschen: %d %v", c, r)
	}
	if len(srv.store.Students) != 4 || len(srv.store.Works[ids[0]]) != 0 || len(srv.store.Works[ids[2]]) != 2 {
		t.Fatalf("falscher Stand nach Arbeiten löschen")
	}

	// Anmeldungen löschen (auch der Lehrkraft-Zugang in der Liste wird übergangen)
	all := append([]string{}, ids...)
	for _, st := range srv.store.Students {
		if st.Teacher {
			all = append(all, st.ID)
		}
	}
	c, r = call(t, h, "POST", "/api/teacher/delete-students", teacher, map[string]any{"students": all})
	if c != 200 || r["students"].(float64) != 3 {
		t.Fatalf("Anmeldungen löschen: %d %v", c, r)
	}
	if len(srv.store.Students) != 1 || !srv.store.Students[0].Teacher || len(srv.store.Works[ids[2]]) != 0 {
		t.Fatalf("nur der Lehrkraft-Zugang sollte bleiben")
	}
}
