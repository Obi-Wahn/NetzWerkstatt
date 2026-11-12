package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
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
	st.flush()
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

func TestMusterloesungenGesammeltFreigeben(t *testing.T) {
	srv, h, teacher := testServer(t)
	room := srv.store.RoomCode
	_, r := login(t, h, room, "Mia", "1234")
	stu := r["token"].(string)

	// einzeln wie bisher
	if code, r := call(t, h, "POST", "/api/teacher/release", teacher, map[string]any{"task": "zwei-pcs", "released": true}); code != 200 {
		t.Fatalf("Einzeln freigeben: %d %v", code, r)
	}
	// ein ganzes Thema auf einmal
	if code, r := call(t, h, "POST", "/api/teacher/release", teacher, map[string]any{"tasks": []string{"bus", "ring", "stern"}, "released": true}); code != 200 {
		t.Fatalf("Thema freigeben: %d %v", code, r)
	}
	_, me := call(t, h, "GET", "/api/me", stu, nil)
	rel := me["released"].(map[string]any)
	for _, id := range []string{"zwei-pcs", "bus", "ring", "stern"} {
		if rel[id] != true {
			t.Fatalf("%s sollte freigegeben sein: %v", id, rel)
		}
	}
	// wieder sperren
	call(t, h, "POST", "/api/teacher/release", teacher, map[string]any{"tasks": []string{"bus", "ring"}, "released": false})
	_, me = call(t, h, "GET", "/api/me", stu, nil)
	rel = me["released"].(map[string]any)
	if rel["bus"] == true || rel["ring"] == true || rel["stern"] != true {
		t.Fatalf("Sperren hat nicht gestimmt: %v", rel)
	}
	// Schüler dürfen nicht freigeben, leere Anfrage ist ungültig
	if code, _ := call(t, h, "POST", "/api/teacher/release", stu, map[string]any{"tasks": []string{"bus"}, "released": true}); code != 401 {
		t.Fatalf("Schüler darf nicht freigeben: %d", code)
	}
	if code, _ := call(t, h, "POST", "/api/teacher/release", teacher, map[string]any{"released": true}); code != 400 {
		t.Fatalf("Leere Anfrage sollte abgelehnt werden: %d", code)
	}
}

func TestArbeitSpeichernRegeln(t *testing.T) {
	srv, h, teacher := testServer(t)
	_, r := login(t, h, srv.store.RoomCode, "Ben", "1234")
	stu := r["token"].(string)
	net := map[string]any{"network": map[string]any{"devices": []any{}, "links": []any{}}}

	// erfundene oder gesperrte Aufgaben werden nicht gespeichert
	if code, _ := call(t, h, "PUT", "/api/work/gibt-es-nicht", stu, net); code != 403 {
		t.Fatalf("Unbekannte Aufgabe sollte abgelehnt werden: %d", code)
	}
	if code, _ := call(t, h, "PUT", "/api/work/zwei-pcs", stu, net); code != 200 {
		t.Fatalf("Freigeschaltete Aufgabe sollte gespeichert werden: %d", code)
	}
	// schon begonnen, dann gesperrt: weiter speicherbar, damit nichts verloren geht
	call(t, h, "POST", "/api/teacher/unlock", teacher, map[string]any{"tasks": []string{"zwei-pcs"}, "unlocked": false})
	if code, _ := call(t, h, "PUT", "/api/work/zwei-pcs", stu, net); code != 200 {
		t.Fatalf("Begonnene Aufgabe sollte weiter speicherbar sein: %d", code)
	}
	// abgegeben: Netz bleibt unverändert, bis die Abgabe zurückgenommen ist
	call(t, h, "PUT", "/api/work/zwei-pcs", stu, map[string]any{"submitted": true})
	if code, _ := call(t, h, "PUT", "/api/work/zwei-pcs", stu, net); code != 409 {
		t.Fatalf("Abgegebene Arbeit sollte nicht änderbar sein: %d", code)
	}
	if code, _ := call(t, h, "PUT", "/api/work/zwei-pcs", stu, map[string]any{"submitted": false}); code != 200 {
		t.Fatalf("Abgabe zurücknehmen sollte gehen: %d", code)
	}
	if code, _ := call(t, h, "PUT", "/api/work/zwei-pcs", stu, net); code != 200 {
		t.Fatalf("Nach dem Zurücknehmen sollte Speichern gehen: %d", code)
	}
}

func TestUebersichtNurNetzeDerAufgabe(t *testing.T) {
	srv, h, teacher := testServer(t)
	_, r := login(t, h, srv.store.RoomCode, "Ida", "1234")
	stu := r["token"].(string)
	net := map[string]any{"network": map[string]any{"devices": []any{}, "links": []any{}}}
	call(t, h, "PUT", "/api/work/zwei-pcs", stu, net)
	call(t, h, "PUT", "/api/work/stern", stu, net)
	_, ov := call(t, h, "GET", "/api/teacher/overview?task=stern", teacher, nil)
	works := ov["students"].([]any)[0].(map[string]any)["works"].(map[string]any)
	if works["stern"].(map[string]any)["network"] == nil || works["zwei-pcs"].(map[string]any)["network"] != nil {
		t.Fatalf("Nur das Netz der gewählten Aufgabe sollte mitkommen: %v", works)
	}
	id := ov["students"].([]any)[0].(map[string]any)["id"].(string)
	if code, wk := call(t, h, "GET", "/api/teacher/work?student="+id+"&task=zwei-pcs", teacher, nil); code != 200 || wk["network"] == nil {
		t.Fatalf("Einzelnes Netz sollte abrufbar sein: %d %v", code, wk)
	}
	if code, _ := call(t, h, "GET", "/api/teacher/work?student="+id+"&task=zwei-pcs", stu, nil); code != 401 {
		t.Fatalf("Schüler dürfen keine fremden Netze abrufen: %d", code)
	}
}

func TestLehrerPasswort(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daten.json")
	st := loadStore(path)
	if !regexp.MustCompile(`^[a-z]+[0-9]{4}$`).MatchString(st.TeacherPassword) {
		t.Fatalf("Neues Passwort sollte Wort + 4 Ziffern sein: %q", st.TeacherPassword)
	}
	// altes, kurzes Passwort wird ersetzt, ein selbst gewähltes bleibt
	st.TeacherPassword = "router42"
	st.saveLocked()
	st.flush()
	if p := loadStore(path).TeacherPassword; p == "router42" {
		t.Fatal("Altes kurzes Passwort sollte ersetzt werden")
	}
	st.TeacherPassword = "geheim"
	st.saveLocked()
	st.flush()
	if p := loadStore(path).TeacherPassword; p != "geheim" {
		t.Fatalf("Eigenes Passwort sollte bleiben: %q", p)
	}

	// nach 5 falschen Versuchen ist dieses Gerät eine Weile gesperrt
	srv, h, _ := testServer(t)
	srv.store.TeacherPassword = "richtig1234"
	for i := 0; i < maxCodeFails; i++ {
		if code, _ := call(t, h, "POST", "/api/teacher/login", "", map[string]string{"password": "falsch"}); code != 403 {
			t.Fatalf("Falsches Passwort: %d", code)
		}
	}
	if code, _ := call(t, h, "POST", "/api/teacher/login", "", map[string]string{"password": "richtig1234"}); code != 429 {
		t.Fatalf("Nach 5 Fehlversuchen sollte gesperrt sein: %d", code)
	}
}

func TestFreigabenProKlasse(t *testing.T) {
	srv, h, teacher := testServer(t)
	room := srv.store.RoomCode

	// Ohne Klassen: gemeinsame Freigaben; die erste Klasse übernimmt sie.
	call(t, h, "POST", "/api/teacher/unlock", teacher, map[string]any{"tasks": []string{"ipv6"}, "unlocked": true})
	call(t, h, "POST", "/api/teacher/demos", teacher, map[string]any{"demos": []string{"dhcp"}, "open": true})
	_, r := call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": "10a"})
	idA := r["id"].(string)
	a := srv.store.classByID(idA)
	if !a.Unlocked["ipv6"] || !a.Unlocked["zwei-pcs"] || !a.Demos["dhcp"] {
		t.Fatalf("Erste Klasse sollte die bisherigen Freigaben übernehmen: %v %v", a.Unlocked, a.Demos)
	}

	// Weitere Klasse: ab Werk oder wie eine andere Klasse.
	_, r = call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": "10b"})
	idB := r["id"].(string)
	b := srv.store.classByID(idB)
	if b.Unlocked["ipv6"] || !b.Unlocked["zwei-pcs"] || len(b.Demos) != 0 {
		t.Fatalf("Neue Klasse sollte wie ab Werk beginnen: %v %v", b.Unlocked, b.Demos)
	}
	_, r = call(t, h, "POST", "/api/teacher/class-add", teacher, map[string]string{"name": "10c", "from": idA})
	if c := srv.store.classByID(r["id"].(string)); !c.Unlocked["ipv6"] || !c.Demos["dhcp"] {
		t.Fatalf("10c sollte die Freigaben der 10a übernehmen: %v", c.Unlocked)
	}

	// Freigaben gelten nur für die genannte Klasse.
	call(t, h, "POST", "/api/teacher/unlock", teacher, map[string]any{"tasks": []string{"dns"}, "unlocked": true, "class": idB})
	call(t, h, "POST", "/api/teacher/release", teacher, map[string]any{"tasks": []string{"stern"}, "released": true, "class": idB})
	call(t, h, "POST", "/api/teacher/demos", teacher, map[string]any{"demos": []string{"webseite"}, "open": true, "class": idB})
	if a.Unlocked["dns"] || a.Released["stern"] || a.Demos["webseite"] {
		t.Fatalf("Freigaben der 10b dürfen die 10a nicht ändern")
	}
	if code, _ := call(t, h, "POST", "/api/teacher/unlock", teacher, map[string]any{"tasks": []string{"dns"}, "unlocked": true, "class": "weg"}); code != 404 {
		t.Fatalf("Unbekannte Klasse sollte 404 geben: %d", code)
	}

	// Lehreransicht bekommt die Freigaben der angezeigten Klasse.
	_, ov := call(t, h, "GET", "/api/teacher/overview?class="+idB, teacher, nil)
	if ov["freigabenClass"] != idB || ov["unlocked"].(map[string]any)["dns"] != true || ov["released"].(map[string]any)["stern"] != true {
		t.Fatalf("Übersicht 10b: %v", ov)
	}

	// Schüler sehen die Freigaben ihrer Klasse.
	_, r = login(t, h, room, "Ali", "1234")
	tokA := r["token"].(string)
	_, me := call(t, h, "GET", "/api/me", tokA, nil)
	if me["unlocked"].(map[string]any)["dns"] != nil || me["unlocked"].(map[string]any)["ipv6"] != true {
		t.Fatalf("10a sieht falsche Aufgaben: %v", me["unlocked"])
	}
	if code, _ := call(t, h, "PUT", "/api/work/dns", tokA, map[string]any{"network": map[string]any{}}); code != 403 {
		t.Fatalf("In der 10a ist DNS gesperrt: %d", code)
	}
	call(t, h, "POST", "/api/teacher/class-activate", teacher, map[string]string{"id": idB})
	_, r = login(t, h, room, "Bea", "1234")
	tokB := r["token"].(string)
	_, me = call(t, h, "GET", "/api/me", tokB, nil)
	if me["unlocked"].(map[string]any)["dns"] != true || me["released"].(map[string]any)["stern"] != true || me["demos"].(map[string]any)["webseite"] != true {
		t.Fatalf("10b sieht ihre Freigaben nicht: %v", me)
	}
	if code, _ := call(t, h, "PUT", "/api/work/dns", tokB, map[string]any{"network": map[string]any{}}); code != 200 {
		t.Fatalf("In der 10b ist DNS frei: %d", code)
	}
	_, d := call(t, h, "GET", "/api/demos?class="+idA, teacher, nil)
	if d["class"] != idA || d["open"].(map[string]any)["webseite"] != nil {
		t.Fatalf("Vorführungen der 10a für die Lehrkraft: %v", d)
	}
}

func TestFreigabenAusAlterDatei(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daten.json")
	old := `{"roomCode":"1234","teacherPassword":"x","released":{"stern":true},"unlocked":{"zwei-pcs":true,"dns":true,"heimnetz":false},
		"demos":{"dhcp":true},"classes":[{"id":"a1","name":"10a"},{"id":"b2","name":"10b"}],"activeClass":"a1"}`
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	s := loadStore(path)
	for _, id := range []string{"a1", "b2"} {
		c := s.classByID(id)
		if !c.Unlocked["dns"] || c.Unlocked["heimnetz"] || !c.Released["stern"] || !c.Demos["dhcp"] {
			t.Fatalf("Klasse %s hat die alten Freigaben nicht übernommen: %+v", id, c.Freigaben)
		}
	}
	// Die Klassen haben jetzt eigene Kopien.
	s.classByID("a1").Unlocked["ipv6"] = true
	if s.classByID("b2").Unlocked["ipv6"] || s.Unlocked["ipv6"] {
		t.Fatalf("Freigaben der Klassen müssen unabhängig sein")
	}
}
