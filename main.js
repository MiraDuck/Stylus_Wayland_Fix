"use strict";
const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");

const LOG_PREFIX = "[Stylus Wayland Fix]";

const DEFAULT_SETTINGS = {
  enabled: true,
  skipMoves: 0,
  showStatusBar: true,
  logEvents: false,
  logMovesAfterDown: 3,
  logJump: false,
  jumpNotice: false,
};

const isPen = (e) => e.pointerType === "pen" && e.isTrusted;
const xy = (e) => `${Math.round(e.clientX)}, ${Math.round(e.clientY)}`;
const dist = (a, b) => Math.round(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));

function listen(win, map) {
  const entries = Object.entries(map);
  entries.forEach(([type, fn]) => win.addEventListener(type, fn, true));
  return () => entries.forEach(([type, fn]) => win.removeEventListener(type, fn, true));
}

/**
 * The fix. Holds back the pen's pointerdown, optionally discards the next
 * `skipMoves` pen moves, then replays the pointerdown at the position of the
 * first move it lets through (or at pointerup, for taps).
 */
function installFix(win, plugin) {
  let held = null;
  let skipped = 0;

  const makeDown = (src, pos) =>
    new win.PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, composed: true,
      pointerId: src.pointerId, pointerType: src.pointerType, isPrimary: src.isPrimary,
      button: src.button, buttons: src.buttons,
      pressure: src.pressure || pos.pressure,
      tangentialPressure: src.tangentialPressure,
      tiltX: src.tiltX, tiltY: src.tiltY, twist: src.twist,
      width: src.width, height: src.height,
      ctrlKey: src.ctrlKey, shiftKey: src.shiftKey, altKey: src.altKey, metaKey: src.metaKey,
      clientX: pos.clientX, clientY: pos.clientY,
      screenX: pos.screenX, screenY: pos.screenY,
    });

  const replay = (pos) => {
    const src = held;
    held = null;
    if (plugin.settings.logEvents) {
      console.log(LOG_PREFIX, "replayed pointerdown at", xy(pos),
        "| moved", dist(src, pos), "px from original | skipped moves", skipped);
    }
    src.target.dispatchEvent(makeDown(src, pos));
  };

  return listen(win, {
    pointerdown: (e) => {
      if (!isPen(e)) return;
      held = e;
      skipped = 0;
      e.stopImmediatePropagation();
    },
    pointermove: (e) => {
      if (!held || !e.isTrusted || e.pointerId !== held.pointerId) return;
      if (skipped < plugin.settings.skipMoves) {
        skipped++;
        e.stopImmediatePropagation();
        return;
      }
      replay(e);
    },
    pointerup: (e) => {
      if (held && e.isTrusted) replay(e);
    },
    pointercancel: () => {
      held = null;
    },
  });
}

/** Debug: logs raw pen events, plus the first few moves after each touch-down. */
function installEventLogger(win, plugin) {
  let remaining = 0;
  const log = (e) => {
    if (!isPen(e)) return;
    if (e.type === "pointermove") {
      if (e.buttons === 0 && remaining <= 0) return;
      remaining--;
    }
    if (e.type === "pointerdown") remaining = plugin.settings.logMovesAfterDown;
    if (e.type === "pointerup" || e.type === "pointercancel") remaining = 0;
    console.log(LOG_PREFIX, e.type, "id", e.pointerId, "button", e.button,
      "buttons", e.buttons, "p", e.pressure.toFixed(2), "xy", xy(e));
  };
  return listen(win, { pointerdown: log, pointermove: log, pointerup: log, pointercancel: log });
}

/** Debug: measures the distance between touch-down and the first move after it. */
function installJumpLogger(win, plugin) {
  let hover = null;
  let down = null;
  return listen(win, {
    pointerdown: (e) => {
      if (!isPen(e)) return;
      down = e;
      console.log(LOG_PREFIX, "down at", xy(e), "| last hover", hover ? xy(hover) : "none");
    },
    pointermove: (e) => {
      if (!isPen(e)) return;
      if (down) {
        const jump = dist(e, down);
        console.log(LOG_PREFIX, "first move after down at", xy(e), "| jump", jump, "px");
        if (plugin.settings.jumpNotice) new Notice(`Stroke-start jump: ${jump} px`, 1500);
        down = null;
      }
      hover = e;
    },
    pointerup: (e) => {
      if (isPen(e)) down = null;
    },
  });
}

class StylusWaylandFixPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.cleanups = new Map(); // window -> array of cleanup functions

    this.addSettingTab(new StylusFixSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-fix",
      name: "Toggle fix",
      callback: () => this.toggle("enabled", "Stylus fix"),
    });
    this.addCommand({
      id: "toggle-event-logging",
      name: "Toggle pen event logging",
      callback: () => this.toggle("logEvents", "Pen event logging"),
    });
    this.addCommand({
      id: "toggle-jump-logging",
      name: "Toggle stroke-start jump logging",
      callback: () => this.toggle("logJump", "Jump logging"),
    });

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.statusEl.setAttr("aria-label", "Toggle stylus fix");
    this.registerDomEvent(this.statusEl, "click", () => this.toggle("enabled", "Stylus fix"));

    // Pop-out windows have their own `window` object.
    this.registerEvent(this.app.workspace.on("window-open", (_ww, win) => this.attach(win)));
    this.registerEvent(this.app.workspace.on("window-close", (_ww, win) => this.detach(win)));

    this.refresh();
  }

  onunload() {
    this.detachAll();
  }

  windows() {
    const wins = [window];
    const floating = this.app.workspace.floatingSplit;
    for (const child of (floating && floating.children) || []) {
      if (child.win && !wins.includes(child.win)) wins.push(child.win);
    }
    return wins;
  }

  attach(win) {
    if (!win || this.cleanups.has(win)) return;
    const s = this.settings;
    const fns = [];
    // Loggers go first so they see raw events before the fix swallows any.
    if (s.logEvents) fns.push(installEventLogger(win, this));
    if (s.logJump) fns.push(installJumpLogger(win, this));
    if (s.enabled) fns.push(installFix(win, this));
    this.cleanups.set(win, fns);
  }

  detach(win) {
    (this.cleanups.get(win) || []).forEach((fn) => fn());
    this.cleanups.delete(win);
  }

  detachAll() {
    for (const win of [...this.cleanups.keys()]) this.detach(win);
  }

  /** Re-installs all listeners in every window with the current settings. */
  refresh() {
    this.detachAll();
    this.windows().forEach((w) => this.attach(w));
    this.updateStatusBar();
  }

  updateStatusBar() {
    if (!this.statusEl) return;
    this.statusEl.toggle(this.settings.showStatusBar);
    this.statusEl.setText(`Stylus fix: ${this.settings.enabled ? "on" : "off"}`);
  }

  async toggle(key, label) {
    this.settings[key] = !this.settings[key];
    await this.saveSettings();
    new Notice(`${label} ${this.settings[key] ? "enabled" : "disabled"}`);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refresh();
  }
}

class StylusFixSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    const s = plugin.settings;
    containerEl.empty();

    const set = (key) => async (value) => {
      s[key] = value;
      await plugin.saveSettings();
    };

    new Setting(containerEl)
      .setName("Enable fix")
      .setDesc("Delay the pen's touch-down until its real position is known, removing the stray line at the start of strokes.")
      .addToggle((t) => t.setValue(s.enabled).onChange(set("enabled")));

    new Setting(containerEl)
      .setName("Moves to skip")
      .setDesc("Pen move events to discard after touch-down before the stroke starts. 0 starts the stroke at the first move. Raise this if a short stray line remains.")
      .addSlider((sl) =>
        sl.setLimits(0, 10, 1).setValue(s.skipMoves).setDynamicTooltip().onChange(set("skipMoves"))
      )
      .addExtraButton((b) =>
        b.setIcon("reset").setTooltip("Restore default").onClick(async () => {
          await set("skipMoves")(DEFAULT_SETTINGS.skipMoves);
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Show in status bar")
      .setDesc("Show a clickable on/off indicator in the status bar.")
      .addToggle((t) => t.setValue(s.showStatusBar).onChange(set("showStatusBar")));

    new Setting(containerEl).setName("Debugging").setHeading();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Log output goes to the developer console (Ctrl+Shift+I). Loggers see the raw pen events, before the fix changes anything.",
    });

    new Setting(containerEl)
      .setName("Log pen events")
      .setDesc("Log every pen down, up and cancel, plus the first moves after each touch-down. Also logs where the fix replays the touch-down.")
      .addToggle((t) => t.setValue(s.logEvents).onChange(set("logEvents")));

    new Setting(containerEl)
      .setName("Moves to log after touch-down")
      .setDesc("How many move events to log after each touch-down when pen event logging is on.")
      .addSlider((sl) =>
        sl.setLimits(1, 20, 1).setValue(s.logMovesAfterDown).setDynamicTooltip().onChange(set("logMovesAfterDown"))
      );

    new Setting(containerEl)
      .setName("Log stroke-start jump")
      .setDesc("Log the last hover position, the touch-down position and the distance to the first move. A large jump is the stray line.")
      .addToggle((t) => t.setValue(s.logJump).onChange(set("logJump")));

    new Setting(containerEl)
      .setName("Show jump as notice")
      .setDesc("Also show the jump distance as a popup, so you can check it without opening the console.")
      .addToggle((t) => t.setValue(s.jumpNotice).onChange(set("jumpNotice")));
  }
}

module.exports = StylusWaylandFixPlugin;
