// Static Accessibility bridge. Never evaluate caller text as JavaScript/code.
ObjC.import("Foundation");

function run() {
  function failure(code) { return JSON.stringify({ error: code }); }
  function attr(element, name) {
    try { return element.attributes.byName(name).value(); } catch (_) { return null; }
  }
  function bounded(value) {
    if (value === null || value === undefined) return "";
    return String(value).slice(0, 200);
  }
  function fieldSignatures(fields) {
    return JSON.stringify(fields.map(function(f) { return [f.role, f.identifier, f.label, f.editable, f.original_value]; }));
  }
  var input;
  try {
    var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    input = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
  } catch (_) { return failure("request"); }
  if (!input || ["inspect", "fill"].indexOf(input.operation) < 0 || typeof input.bundle_id !== "string" || typeof input.title !== "string") return failure("request");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/.test(input.bundle_id)) return failure("request");
  var se = Application("System Events"), process, window;
  try {
    if (!se.UIElementsEnabled()) return failure("permissions");
    var processes = se.applicationProcesses.whose({ bundleIdentifier: input.bundle_id })();
    if (processes.length !== 1) return failure("application");
    process = processes[0];
    var windows = process.windows.whose({ name: input.title })();
    if (windows.length !== 1) return failure("window");
    window = windows[0];
  } catch (_) { return failure("permissions"); }
  var collected = [], queue = [{ element: window, depth: 0 }], visited = 0;
  var sensitive = /password|passwd|secret|api.?key|token|otp|\bpin\b|密码|口令|密钥|验证码/i;
  try {
    while (queue.length) {
      var entry = queue.shift(), element = entry.element;
      if (++visited > 300 || entry.depth > 12) return failure("unsupported");
      var role = bounded(attr(element, "AXRole"));
      var subrole = bounded(attr(element, "AXSubrole"));
      var rawIdentifier = attr(element, "AXIdentifier");
      var rawLabel = attr(element, "AXTitle") || attr(element, "AXDescription") || attr(element, "AXHelp");
      var identifier = rawIdentifier === null || rawIdentifier === undefined ? "" : String(rawIdentifier);
      var label = rawLabel === null || rawLabel === undefined ? "" : String(rawLabel);
      if (identifier.length > 200 || label.length > 200) return failure("unsupported");
      var protectedContent = attr(element, "AXProtectedContent");
      var secure = role === "AXSecureTextField" || subrole === "AXSecureTextField" || protectedContent === true || protectedContent === 1 || sensitive.test(identifier + " " + label);
      if (!secure && ["AXTextField", "AXTextArea"].indexOf(role) >= 0 && (identifier || label)) {
        if (collected.length >= 60) return failure("unsupported");
        var editable = false;
        try { editable = element.attributes.byName("AXValue").settable() === true && attr(element, "AXEnabled") !== false; } catch (_) {}
        var descriptor = { role: role, identifier: identifier, label: label };
        var originalValue = attr(element, "AXValue");
        originalValue = originalValue === null || originalValue === undefined ? "" : String(originalValue);
        if (originalValue.length > 4000) return failure("unsupported");
        collected.push({ element: element, field: { role: role, identifier: identifier, label: label, selector: JSON.stringify(descriptor), editable: editable, original_value: originalValue } });
      }
      // Do not descend into secure controls or reveal their children/values.
      if (!secure) {
        var children = element.uiElements();
        if (children.length > 300) return failure("unsupported");
        for (var i = 0; i < children.length; i++) queue.push({ element: children[i], depth: entry.depth + 1 });
      }
    }
  } catch (_) { return failure("unsupported"); }
  var counts = {};
  collected.forEach(function(item) { counts[item.field.selector] = (counts[item.field.selector] || 0) + 1; });
  collected = collected.filter(function(item) { return counts[item.field.selector] === 1; });
  var fields = collected.map(function(item) { return item.field; });
  if (!fields.length) return failure("unsupported");
  if (input.operation === "inspect") return JSON.stringify({ fields: fields });
  if (!Array.isArray(input.expected_fields) || fieldSignatures(fields) !== fieldSignatures(input.expected_fields)) return failure("changed");
  if (!input.target || typeof input.text !== "string" || input.text.length > 4000) return failure("request");
  var matches = collected.filter(function(item) {
    return item.field.role === input.target.role && item.field.identifier === input.target.identifier && item.field.label === input.target.label;
  });
  if (matches.length !== 1 || !matches[0].field.editable) return failure("target");
  try {
    matches[0].element.attributes.byName("AXValue").value = input.text;
    for (var attempt = 0; attempt < 20; attempt++) {
      if (String(attr(matches[0].element, "AXValue")) === input.text) return JSON.stringify({ verified: true });
      delay(0.05);
    }
  } catch (_) { return failure("target"); }
  return failure("verification");
}
