(() => {
  if (window.__GLOWTRACK_PASTE_IMPORT_UPGRADE__) return;
  window.__GLOWTRACK_PASTE_IMPORT_UPGRADE__ = true;

  const dataPanel = document.querySelector(".data-panel") || document.querySelector(".soft-panel");
  const historyFeedback = document.getElementById("history-feedback");

  if (!dataPanel || document.getElementById("paste-import-json")) return;

  const wrapper = document.createElement("details");
  wrapper.className = "paste-import-card";
  wrapper.innerHTML = `
    <summary>Paste JSON backup</summary>
    <div class="field paste-import-body">
      <label for="paste-import-json">Raw JSON</label>
      <textarea id="paste-import-json" class="compact-textarea" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Paste a GlowTrack JSON export here. Code fences like \`\`\`json are okay."></textarea>
      <div class="list-item-actions">
        <button id="paste-import-button" class="primary-button" type="button">Import pasted JSON</button>
        <button id="paste-import-clear" class="ghost-button" type="button">Clear</button>
      </div>
      <p id="paste-import-feedback" class="helper"></p>
    </div>
  `;

  dataPanel.insertBefore(wrapper, historyFeedback || null);

  document.getElementById("paste-import-button").addEventListener("click", importPastedJson);
  document.getElementById("paste-import-clear").addEventListener("click", () => {
    document.getElementById("paste-import-json").value = "";
    setPasteFeedback("");
  });

  function importPastedJson() {
    const input = document.getElementById("paste-import-json");
    const raw = input.value;
    const cleaned = cleanJsonInput(raw);

    if (!cleaned) {
      setPasteFeedback("Paste JSON first.", true);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      setPasteFeedback("That does not look like valid JSON. Check for missing commas, extra commentary, or smart quotes.", true);
      return;
    }

    if (!confirm("Import this pasted backup? This will replace the GlowTrack data stored in this browser.")) return;

    try {
      state = validateImportedState(parsed);
      render();
      input.value = "";
      wrapper.open = false;
      setPasteFeedback("");
      setHistoryFeedback("Pasted JSON imported successfully.");
    } catch (error) {
      setPasteFeedback("The JSON parsed, but it does not match GlowTrack backup structure.", true);
    }
  }

  function cleanJsonInput(value) {
    let text = String(value || "").trim().replace(/^\uFEFF/, "");
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    if (text.startsWith("{") || text.startsWith("[")) return text;

    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);

    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1);

    return text;
  }

  function setPasteFeedback(message, isError = false) {
    const feedback = document.getElementById("paste-import-feedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("danger-text", isError);
  }
})();
