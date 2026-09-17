const styles = {
  main: {
    minHeight: "100svh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "2rem",
    gap: "1.25rem",
  },
  kicker: {
    margin: 0,
    letterSpacing: "0.35em",
    fontSize: "0.78rem",
    color: "#8a8f98",
    fontWeight: 600,
  },
  h1: {
    margin: 0,
    maxWidth: "22ch",
    fontSize: "clamp(1.6rem, 4.5vw, 3.1rem)",
    lineHeight: 1.15,
    fontWeight: 650,
    letterSpacing: "-0.01em",
    color: "#f2f0ed",
  },
  sub: {
    margin: 0,
    maxWidth: "58ch",
    color: "#a7adb6",
    fontSize: "1.02rem",
    lineHeight: 1.6,
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.55rem",
    border: "1px solid #232830",
    background: "#12151a",
    color: "#cfd4db",
    borderRadius: "999px",
    padding: "0.5rem 1rem",
    fontSize: "0.86rem",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#57d38c",
    boxShadow: "0 0 10px #57d38c88",
  },
  footer: {
    marginTop: "1.5rem",
    color: "#5c636d",
    fontSize: "0.78rem",
    letterSpacing: "0.06em",
  },
};

function App() {
  return (
    <main style={styles.main}>
      <p style={styles.kicker}>CLUSTERBREAK</p>
      <h1 style={styles.h1}>Build a rig. Run a model. Break it on purpose.</h1>
      <p style={styles.sub}>
        An interactive simulator for local AI inference clusters — pick real hardware, choose a
        model and quantization, watch tokens/s and VRAM move, then unplug a node and see exactly
        what dies and why.
      </p>
      <div style={styles.status}>
        <span style={styles.dot} />
        Day 1 · simulation engine + API are live — the interactive rig builder lands next
      </div>
      <footer style={styles.footer}>FIRST COMMIT · BHARAT BUILDS TOUR · SEP 17–20 2026</footer>
    </main>
  );
}

export default App;
