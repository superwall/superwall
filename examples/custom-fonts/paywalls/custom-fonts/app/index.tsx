export default function Index() {
  return (
    <main className="page">
      <div className="lede">
        <h1>Custom fonts</h1>
        <p>
          Use any typeface you like. The file lives in this project and the build takes care of
          serving it.
        </p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">headline &amp; body</span>
          <span className="kv-value">Manrope, from assets/</span>
        </div>
        <div className="kv">
          <span className="kv-key">mono</span>
          <span className="kv-value">Roboto Mono, from a stylesheet</span>
        </div>
      </div>

      <p className="note">
        Drop any font in <code>assets/</code> and point an <code>@font-face</code> at it. The build
        uploads it to our CDN and rewrites the URL for you — nothing to host, nothing to configure.
      </p>
    </main>
  );
}
