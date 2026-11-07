// NetzWerkstatt – Server für das Netzwerk-Lernspiel.
//
// Das Programm wird auf dem Lehrer-Rechner gestartet (Doppelklick genügt).
// Schülerinnen und Schüler öffnen die angezeigte Adresse im Browser.
// Alle Daten bleiben in einer Datei neben dem Programm; es wird nichts aus
// dem Internet geladen oder dorthin gesendet.
package main

import (
	"crypto/rand"
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

func (s *Store) studentByToken(tok string) *Student {
	if tok == "" {
		return nil
	}
	for _, st := range s.Students {
		if st.Token == tok {
			return st
		}
	}
	return nil
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
}

func (srv *Server) isTeacher(r *http.Request) bool {
	srv.tmu.Lock()
	defer srv.tmu.Unlock()
	_, ok := srv.teacherTokens[bearer(r)]
	return ok
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

	// Schüler-Anmeldung: Name + Raumcode
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Name, Room string }
		if err := readBody(r, &req); err != nil {
			fail(w, 400, "Ungültige Anfrage.")
			return
		}
		name := normName(req.Name)
		if name == "" {
			fail(w, 400, "Bitte gib deinen Namen ein.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if strings.TrimSpace(req.Room) != s.RoomCode {
			fail(w, 403, "Der Raumcode stimmt nicht. Schau an die Tafel oder frag deine Lehrkraft.")
			return
		}
		for _, st := range s.Students {
			if strings.EqualFold(st.Name, name) {
				writeJSON(w, 200, map[string]any{"token": st.Token, "name": st.Name, "returning": true})
				return
			}
		}
		st := &Student{ID: randomToken(6), Name: name, Token: randomToken(16), Created: time.Now().Unix()}
		s.Students = append(s.Students, st)
		s.saveLocked()
		writeJSON(w, 200, map[string]any{"token": st.Token, "name": st.Name})
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
		writeJSON(w, 200, map[string]any{"name": st.Name, "works": status, "released": s.Released})
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
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Works map[string]Work `json:"works"`
		}
		rows := []row{}
		for _, st := range s.Students {
			rows = append(rows, row{ID: st.ID, Name: st.Name, Works: s.Works[st.ID]})
		}
		sort.Slice(rows, func(i, j int) bool { return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name) })
		addrs := []string{}
		for _, ip := range localIPs() {
			addrs = append(addrs, fmt.Sprintf("http://%s:%d", ip, srv.port))
		}
		writeJSON(w, 200, map[string]any{"students": rows, "released": s.Released, "roomCode": s.RoomCode, "addresses": addrs})
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
