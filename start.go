package main

// Start des Programms: alles prüfen, verständlich melden, Browser öffnen.

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Version wird beim Bauen der Download-Pakete gesetzt (-ldflags "-X main.Version=…").
var Version = "Entwicklungsstand"

const line = "=============================================================="

var interactive = true // bei Fehlern auf Enter warten, damit das Fenster offen bleibt

func warn(msg string) {
	fmt.Println()
	fmt.Println("  ! Hinweis: " + msg)
}

// fatal zeigt einen Fehler und wartet, damit sich das Fenster nicht sofort schließt.
func fatal(msg string) {
	fmt.Println()
	fmt.Println(line)
	fmt.Println("  Die NetzWerkstatt konnte nicht starten.")
	fmt.Println(line)
	fmt.Println()
	fmt.Println("  " + strings.ReplaceAll(msg, "\n", "\n  "))
	fmt.Println()
	if interactive {
		fmt.Println("  Drücke Enter, um dieses Fenster zu schließen.")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	}
	os.Exit(1)
}

func check(ok bool, label string) {
	mark := "ok"
	if !ok {
		mark = "!!"
	}
	fmt.Printf("  [%s] %s\n", mark, label)
}

// dataPath bestimmt, wo die Daten gespeichert werden, und prüft, ob dort geschrieben werden kann.
func dataPath(flagPath string) string {
	if flagPath != "" {
		if err := writable(filepath.Dir(flagPath)); err != nil {
			fatal("In den Ordner der Datendatei kann nicht geschrieben werden:\n  " + filepath.Dir(flagPath))
		}
		return flagPath
	}
	exe, err := os.Executable()
	dir := "."
	if err == nil {
		if r, err := filepath.EvalSymlinks(exe); err == nil {
			exe = r
		}
		dir = filepath.Dir(exe)
	}
	lower := strings.ToLower(dir)
	if runtime.GOOS == "windows" && strings.Contains(lower, `\appdata\local\temp`) {
		fatal("Das Programm wurde direkt aus der ZIP-Datei gestartet.\n" +
			"Bitte die ZIP-Datei zuerst entpacken (Rechtsklick → „Alle extrahieren …“)\n" +
			"und dann die NetzWerkstatt im entpackten Ordner starten.\n" +
			"Sonst gehen die Arbeiten der Schülerinnen und Schüler verloren.")
	}
	if writable(dir) == nil {
		return filepath.Join(dir, "netzwerkstatt-daten.json")
	}
	// Ausweichen in den Benutzerordner (z. B. wenn das Programm auf einem schreibgeschützten Laufwerk liegt)
	if cfg, err := os.UserConfigDir(); err == nil {
		alt := filepath.Join(cfg, "NetzWerkstatt")
		if os.MkdirAll(alt, 0o700) == nil && writable(alt) == nil {
			warn("Im Programmordner kann nicht gespeichert werden. Die Daten werden stattdessen hier gespeichert:\n      " + alt)
			return filepath.Join(alt, "netzwerkstatt-daten.json")
		}
	}
	fatal("Es gibt keinen Ordner, in dem die NetzWerkstatt ihre Daten speichern darf.\n" +
		"Kopiere das Programm bitte in einen eigenen Ordner, z. B. in „Dokumente“.")
	return ""
}

func writable(dir string) error {
	f, err := os.CreateTemp(dir, ".nw-test-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

// runningInstance prüft, ob auf dem Port schon eine NetzWerkstatt läuft.
func runningInstance(port int) bool {
	c := http.Client{Timeout: 800 * time.Millisecond}
	res, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/info", port))
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var info struct{ App string }
	return json.NewDecoder(res.Body).Decode(&info) == nil && info.App == "NetzWerkstatt"
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func main() {
	port := flag.Int("port", 8080, "Port, auf dem der Server lauscht")
	dataFile := flag.String("daten", "", "Pfad zur Datendatei (Standard: neben dem Programm)")
	room := flag.String("raumcode", "", "Raumcode festlegen (sonst wird bei jedem Start ein neuer ausgewürfelt)")
	pw := flag.String("passwort", "", "Lehrer-Passwort festlegen (sonst bleibt das gespeicherte bzw. ein zufälliges)")
	noBrowser := flag.Bool("kein-browser", false, "Lehrkraft-Ansicht nicht automatisch im Browser öffnen")
	flag.Parse()
	interactive = !*noBrowser

	fmt.Println(line)
	fmt.Println("  NetzWerkstatt " + Version + " wird gestartet …")
	fmt.Println(line)
	fmt.Println()

	// 1. Speicherort
	path := dataPath(*dataFile)
	check(true, "Speicherort gefunden")

	// 2. Läuft schon eine NetzWerkstatt?
	if runningInstance(*port) {
		fmt.Println()
		fmt.Println("  Die NetzWerkstatt läuft bereits (in einem anderen Fenster).")
		fmt.Println("  Die Lehrkraft-Ansicht wird im Browser geöffnet.")
		if !*noBrowser {
			_ = openBrowser(fmt.Sprintf("http://localhost:%d/lehrer", *port))
		}
		time.Sleep(3 * time.Second)
		return
	}

	// 3. Daten laden
	store := loadStore(path)
	// Bei jedem Start einen neuen Raumcode, damit ein alter Code aus einer
	// früheren Stunde nicht mehr funktioniert. Wer schon angemeldet ist,
	// arbeitet trotzdem weiter (die Anmeldung hängt nicht am Raumcode).
	if *room != "" {
		store.RoomCode = *room
	} else {
		old := store.RoomCode
		for store.RoomCode == old {
			store.RoomCode = randomDigits(4)
		}
	}
	if *pw != "" {
		store.TeacherPassword = *pw
	}
	store.saveLocked()
	check(true, "Daten geladen ("+fmt.Sprint(len(store.Students))+" angemeldete Schülerinnen und Schüler)")

	// 4. Port
	var ln net.Listener
	var err error
	p := *port
	for tries := 0; tries < 20; tries++ {
		ln, err = net.Listen("tcp", fmt.Sprintf(":%d", p))
		if err == nil {
			break
		}
		p++
	}
	if err != nil {
		fatal(fmt.Sprintf("Die Ports %d bis %d sind alle belegt.\nStarte den Rechner neu oder wähle einen anderen Port, z. B.: netzwerkstatt -port 9000", *port, p-1))
	}
	if p != *port {
		check(true, fmt.Sprintf("Port %d war belegt, nutze stattdessen Port %d", *port, p))
	} else {
		check(true, fmt.Sprintf("Port %d ist frei", p))
	}

	// 5. Netzwerk
	ips := localIPs()
	check(len(ips) > 0, "Netzwerkverbindung")
	if len(ips) == 0 {
		warn("Dieser Rechner hat keine Netzwerkverbindung. Die NetzWerkstatt funktioniert\n    nur auf diesem Rechner. Für die Klasse bitte mit dem Schulnetz (LAN/WLAN) verbinden.")
	}

	srv := &Server{port: p, store: store, teacherTokens: map[string]time.Time{}, codeFails: map[string]*codeFail{}}

	// Einmal-Anmeldung für die automatisch geöffnete Lehrkraft-Ansicht
	autoTok := randomToken(16)
	srv.teacherTokens[autoTok] = time.Now()

	errc := make(chan error, 1)
	go func() { errc <- http.Serve(ln, srv.routes()) }()

	fmt.Println()
	fmt.Println(line)
	fmt.Println("  NetzWerkstatt läuft.  Dieses Fenster bitte offen lassen!")
	fmt.Println("  (Zum Beenden das Fenster schließen.)")
	fmt.Println(line)
	fmt.Println()
	fmt.Println("  Adresse für die Schülerinnen und Schüler:")
	if len(ips) == 0 {
		fmt.Printf("      http://localhost:%d   (nur auf diesem Rechner)\n", p)
	} else {
		fmt.Printf("      http://%s:%d\n", ips[0], p)
		if len(ips) > 1 {
			fmt.Println("      (Falls das nicht klappt: In der Lehrkraft-Ansicht kann eine andere Adresse gewählt werden.)")
		}
	}
	fmt.Println()
	fmt.Printf("  Raumcode:          %s\n", store.RoomCode)
	fmt.Println()
	fmt.Println("  Lehrkraft-Ansicht:")
	fmt.Printf("      http://localhost:%d/lehrer\n", p)
	fmt.Printf("  Lehrer-Passwort:   %s\n", store.TeacherPassword)
	fmt.Println()
	fmt.Println("  Daten werden gespeichert in:")
	fmt.Println("      " + path)
	fmt.Println(line)
	if runtime.GOOS == "windows" && len(ips) > 0 {
		fmt.Println()
		fmt.Println("  Falls Windows fragt, ob die NetzWerkstatt im Netzwerk kommunizieren darf:")
		fmt.Println("  bitte „Zugriff zulassen“ wählen, sonst können sich die Geräte nicht verbinden.")
	}

	if !*noBrowser {
		url := fmt.Sprintf("http://localhost:%d/lehrer#token=%s", p, autoTok)
		if openBrowser(url) != nil {
			fmt.Println()
			fmt.Println("  Der Browser konnte nicht automatisch geöffnet werden.")
			fmt.Printf("  Bitte selbst öffnen: http://localhost:%d/lehrer\n", p)
		}
	}

	if err := <-errc; err != nil {
		fatal("Der Server wurde unerwartet beendet: " + err.Error())
	}
}
