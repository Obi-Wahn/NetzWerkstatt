package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func rawCall(t *testing.T, srv *Server, method, url, token string, body []byte) (int, []byte) {
	t.Helper()
	req := httptest.NewRequest(method, url, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func TestSicherungUndWiederherstellen(t *testing.T) {
	srv, h, teacher := testServer(t)
	room := srv.store.RoomCode
	pw := srv.store.TeacherPassword

	call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": "10a"})
	_, r := login(t, h, room, "Lena", "1234")
	lena := r["token"].(string)
	if code, _ := call(t, h, "PUT", "/api/work/zwei-pcs", lena, map[string]any{"network": map[string]any{"devices": []any{}}, "submitted": true}); code != 200 {
		t.Fatalf("Arbeit speichern: %d", code)
	}
	call(t, h, "POST", "/api/teacher/custom", teacher, map[string]any{"task": map[string]any{"id": "eigen-test", "title": "Test", "goals": []any{}}})

	if code, _ := rawCall(t, srv, "GET", "/api/teacher/backup", "", nil); code != 401 {
		t.Fatalf("Sicherung ohne Anmeldung: %d", code)
	}
	code, backup := rawCall(t, srv, "GET", "/api/teacher/backup", teacher, nil)
	if code != 200 {
		t.Fatalf("Sicherung: %d %s", code, backup)
	}
	if strings.Contains(string(backup), pw) || strings.Contains(string(backup), "teacherPassword") || strings.Contains(string(backup), "roomCode") {
		t.Fatalf("Sicherung darf Passwort und Raumcode nicht enthalten")
	}

	// Danach alles ändern: Schüler weg, Klasse weg.
	call(t, h, "POST", "/api/teacher/class-delete", teacher, map[string]string{"id": srv.store.Classes[0].ID})
	call(t, h, "POST", "/api/teacher/custom-delete", teacher, map[string]string{"id": "eigen-test"})
	if len(srv.store.Classes) != 0 || len(srv.store.CustomTasks) != 0 {
		t.Fatalf("Vorbereitung: Klasse/Aufgabe sollte gelöscht sein")
	}

	// Vorschau ändert nichts.
	code, prev := rawCall(t, srv, "POST", "/api/teacher/restore-check", teacher, backup)
	var pr map[string]map[string]float64
	_ = json.Unmarshal(prev, &pr)
	if code != 200 || pr["counts"]["students"] != 1 || pr["counts"]["works"] != 1 || pr["counts"]["classes"] != 1 || pr["counts"]["customTasks"] != 1 {
		t.Fatalf("Vorschau: %d %s", code, prev)
	}
	if len(srv.store.Classes) != 0 {
		t.Fatalf("Vorschau darf nichts verändern")
	}

	code, res := rawCall(t, srv, "POST", "/api/teacher/restore", teacher, backup)
	if code != 200 {
		t.Fatalf("Wiederherstellen: %d %s", code, res)
	}
	st := srv.store
	if len(st.Classes) != 1 || st.Classes[0].Name != "10a" || len(st.CustomTasks) != 1 || st.ActiveClass != st.Classes[0].ID {
		t.Fatalf("Klassen/Aufgaben nicht wiederhergestellt")
	}
	if st.RoomCode != room || st.TeacherPassword != pw {
		t.Fatalf("Raumcode und Passwort müssen bleiben")
	}
	// Lena ist wieder angemeldet und hat ihre Arbeit.
	if code, w := call(t, h, "GET", "/api/work/zwei-pcs", lena, nil); code != 200 || w["submitted"] != true {
		t.Fatalf("Arbeit nach Wiederherstellen: %d %v", code, w)
	}
	// Der alte Stand liegt als Kopie neben der Datendatei, die Datei ist geschrieben.
	var rr map[string]any
	_ = json.Unmarshal(res, &rr)
	if _, err := os.Stat(filepath.Join(filepath.Dir(st.path), rr["copy"].(string))); err != nil {
		t.Fatalf("Kopie des alten Stands fehlt: %v", err)
	}
	if again := loadStore(st.path); len(again.Classes) != 1 || len(again.Students) != 1 {
		t.Fatalf("Wiederhergestellte Daten nicht in der Datei")
	}

	// Falsche Dateien werden abgelehnt.
	for _, b := range []string{`kein json`, `{"format":"etwas"}`, `{"format":"netzwerkstatt-sicherung","version":99,"data":{}}`,
		`{"format":"netzwerkstatt-sicherung","version":1,"data":{"students":[{"id":"a","name":"A","token":"t"},{"id":"a","name":"B","token":"u"}]}}`} {
		if code, _ := rawCall(t, srv, "POST", "/api/teacher/restore", teacher, []byte(b)); code != 400 {
			t.Fatalf("Ungültige Sicherung %q sollte abgelehnt werden: %d", b, code)
		}
	}
	if len(st.Classes) != 1 {
		t.Fatalf("Abgelehnte Sicherung darf nichts verändern")
	}

	// Eine Datendatei direkt geht auch.
	raw, _ := os.ReadFile(st.path)
	if code, _ := rawCall(t, srv, "POST", "/api/teacher/restore-check", teacher, raw); code != 200 {
		t.Fatalf("Datendatei als Sicherung: %d", code)
	}
}
