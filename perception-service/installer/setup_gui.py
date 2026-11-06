"""The DVS CCTV setup window.

    setup_gui.py              full setup
    setup_gui.py --test       "Run camera test again" (desktop shortcut)
    setup_gui.py --uninstall  remove everything (desktop shortcut)

Works over Chrome Remote Desktop, where Shift does not reach this PC: the
password and key fields have a Paste button and a click-to-type keyboard for
capitals and symbols.
"""
from __future__ import annotations

import queue
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

sys.path.insert(0, str(Path(__file__).resolve().parent))

import setup_core as core  # noqa: E402
from ingestion.dvr_finder import find_devices  # noqa: E402
from system_load import read_status  # noqa: E402

KEY_HELP = ("Service key: on render.com open dvs-industry-api → Environment → "
            "CAMERA_SERVICE_KEY, and copy its value.")
CAPITALS = ["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ"]
SYMBOLS = ["!@#$%^&*()_", "+{}|:\"<>?~"]
WAIT_FOR_CAMERAS_S = 240


class Setup(tk.Tk):
    def __init__(self, test_only: bool = False):
        super().__init__()
        self.title("DVS CCTV setup")
        self.geometry("820x680")
        self.events: queue.Queue = queue.Queue()
        self.test_only = test_only
        self.page = ttk.Frame(self, padding=18)
        self.page.pack(fill="both", expand=True)
        self.last_entry = None
        self.after(100, self._pump)
        if test_only:
            self.show_test()
        else:
            self.show_form()

    # ── helpers ──────────────────────────────────────────────────────────
    def _pump(self) -> None:
        try:
            while True:
                self.events.get_nowait()()
        except queue.Empty:
            pass
        self.after(100, self._pump)

    def later(self, action) -> None:
        """Run something on the window's thread."""
        self.events.put(action)

    def background(self, work) -> None:
        threading.Thread(target=work, daemon=True).start()

    def clear(self, title: str) -> None:
        for child in self.page.winfo_children():
            child.destroy()
        ttk.Label(self.page, text=title, font=("Segoe UI", 15, "bold")).pack(anchor="w", pady=(0, 10))

    def log_box(self, height: int = 16) -> tk.Text:
        box = tk.Text(self.page, height=height, font=("Segoe UI", 11), wrap="word", state="disabled")
        box.pack(fill="both", expand=True)
        return box

    def say(self, box: tk.Text, text: str) -> None:
        def add() -> None:
            box.configure(state="normal")
            box.insert("end", text + "\n")
            box.see("end")
            box.configure(state="disabled")

        self.later(add)

    # ── 1. the form ──────────────────────────────────────────────────────
    def show_form(self) -> None:
        self.clear("Connect to the cameras")
        saved = core.read_env()
        # Packed first, so a small screen cannot cut it off
        ttk.Button(self.page, text="Save and test the cameras", command=self.save_form).pack(side="bottom", anchor="e")
        grid = ttk.Frame(self.page)
        grid.pack(fill="x")
        grid.columnconfigure(1, weight=1)
        self.fields: dict[str, tk.StringVar] = {}

        def field(row: int, label: str, key: str, secret: bool = False) -> ttk.Entry:
            ttk.Label(grid, text=label).grid(row=row, column=0, sticky="w", pady=5, padx=(0, 10))
            var = tk.StringVar(value=saved.get(key, core.DEFAULTS.get(key, "")))
            entry = ttk.Entry(grid, textvariable=var, show="•" if secret else "", font=("Segoe UI", 11))
            entry.grid(row=row, column=1, sticky="ew")
            entry.bind("<FocusIn>", lambda _e, w=entry: setattr(self, "last_entry", w))
            self.fields[key] = var
            return entry

        field(0, "DVR address", "DVR_HOST")
        ttk.Button(grid, text="Find DVR", command=self.find_dvr).grid(row=0, column=2, padx=(8, 0))
        field(1, "DVR username", "DVR_USERNAME")
        self.password_entry = field(2, "DVR password", "DVR_PASSWORD", secret=True)
        ttk.Button(grid, text="Paste", command=lambda: self.paste("DVR_PASSWORD")).grid(row=2, column=2, padx=(8, 0))
        field(3, "Website API URL", "DASHBOARD_BACKEND_URL")
        self.key_entry = field(4, "Service key", "DASHBOARD_SERVICE_KEY", secret=True)
        ttk.Button(grid, text="Paste", command=lambda: self.paste("DASHBOARD_SERVICE_KEY")).grid(row=4, column=2, padx=(8, 0))

        ttk.Label(self.page, text=KEY_HELP, wraplength=700, foreground="#555").pack(anchor="w", pady=(8, 2))
        tools = ttk.Frame(self.page)
        tools.pack(anchor="w", pady=4)
        self.show_secrets = tk.BooleanVar(value=False)
        ttk.Checkbutton(tools, text="Show what I typed", variable=self.show_secrets,
                        command=self.toggle_secrets).pack(side="left")
        ttk.Button(tools, text="Capitals and symbols keyboard", command=self.toggle_keyboard).pack(side="left", padx=12)
        self.keyboard = ttk.Frame(self.page)
        self.results = tk.Listbox(self.page, height=4, font=("Segoe UI", 10))
        self.results.bind("<<ListboxSelect>>", self.pick_device)
        self.message = ttk.Label(self.page, text="", foreground="#B42318", wraplength=700)
        self.message.pack(anchor="w", pady=6)

    def paste(self, key: str) -> None:
        try:
            self.fields[key].set(self.clipboard_get().strip())
        except tk.TclError:
            self.message.configure(text="Nothing to paste: copy the text first.")

    def toggle_secrets(self) -> None:
        mark = "" if self.show_secrets.get() else "•"
        self.password_entry.configure(show=mark)
        self.key_entry.configure(show=mark)

    def toggle_keyboard(self) -> None:
        if self.keyboard.winfo_ismapped():
            self.keyboard.pack_forget()
            return
        if not self.keyboard.winfo_children():
            ttk.Label(self.keyboard, text="Click in a field, then click the keys:").pack(anchor="w")
            for row in [*CAPITALS, *SYMBOLS]:
                line = ttk.Frame(self.keyboard)
                line.pack(anchor="w")
                for ch in row:
                    # takefocus=False keeps the cursor in the field being typed in
                    tk.Button(line, text=ch, width=3, takefocus=False,
                              command=lambda c=ch: self.press(c)).pack(side="left")
        self.keyboard.pack(anchor="w", pady=4, before=self.message)

    def press(self, char: str) -> None:
        if self.last_entry is not None:
            self.last_entry.insert("insert", char)

    def find_dvr(self) -> None:
        self.message.configure(text="Looking on the network, about 30 seconds…", foreground="#555")
        self.results.pack_forget()

        def work() -> None:
            devices = find_devices(core.DVR_MAC, 554, self.fields["DVR_HOST"].get())

            def show() -> None:
                self.devices = devices
                self.results.delete(0, "end")
                for device in devices:
                    self.results.insert("end", device.label())
                if devices:
                    self.results.pack(fill="x", before=self.message)
                    self.message.configure(text="Click one to use it.", foreground="#555")
                    if devices[0].is_dvr:
                        self.fields["DVR_HOST"].set(devices[0].address)
                else:
                    self.message.configure(text="Nothing found. Check the DVR is on and its cable is in.",
                                           foreground="#B42318")

            self.later(show)

        self.background(work)

    def pick_device(self, _event) -> None:
        chosen = self.results.curselection()
        if chosen:
            self.fields["DVR_HOST"].set(self.devices[chosen[0]].address)

    def save_form(self) -> None:
        form = {k: v.get() for k, v in self.fields.items()}
        problem = core.validate_form(form)
        if problem:
            self.message.configure(text=problem, foreground="#B42318")
            return
        core.write_env(form)
        self.show_test()

    # ── 2. camera test ───────────────────────────────────────────────────
    def show_test(self) -> None:
        self.clear("Testing the cameras")
        box = self.log_box()
        buttons = ttk.Frame(self.page)
        buttons.pack(fill="x", pady=(10, 0))
        saved = core.read_env()
        for key, value in saved.items():
            core.os.environ[key] = value

        def work() -> None:
            self.say(box, "Checking the website, this can take a minute…")
            ok_site, text = core.check_website(saved.get("DASHBOARD_BACKEND_URL", ""),
                                               saved.get("DASHBOARD_SERVICE_KEY", ""))
            self.say(box, text)
            self.say(box, "Checking the cameras…")
            good, no_video, blocked, url_format = [], [], [False], [None]

            def on_event(event: dict) -> None:
                if event.get("kind") == "camera":
                    self.say(box, event["line"])
                    if event["ok"]:
                        good.append(event["channel"])
                        if not event.get("video", True):
                            no_video.append(event["channel"])
                elif event.get("kind") == "done":
                    url_format[0] = event["url_format"]
                elif event.get("message"):
                    blocked[0] = True
                    self.say(box, event["message"])

            core.run_probe(on_event)
            if url_format[0]:
                core.save_setting("DVR_URL_FORMAT", url_format[0])
            self.say(box, f"\n{len(good)} of 8 cameras working.")
            if no_video:
                self.say(box, f"{len(no_video)} of these gave a picture only, so the AI monitoring "
                              "will not work on them yet. Send this page to support.")

            def finish() -> None:
                if not self.test_only:
                    ttk.Button(buttons, text="Back", command=self.show_form).pack(side="left")
                if good:
                    ttk.Button(buttons, text="Next: save a picture from each camera",
                               command=self.show_pictures).pack(side="right")
                elif self.test_only:
                    ttk.Button(buttons, text="Close", command=self.destroy).pack(side="right")

            self.later(finish)

        self.background(work)

    # ── 3. pictures ──────────────────────────────────────────────────────
    def show_pictures(self) -> None:
        self.clear("A picture from each camera")
        ttk.Label(self.page, text="Write down which area each camera shows. Pictures are saved in "
                                  f"{core.SNAPSHOTS}", wraplength=700).pack(anchor="w")
        progress = ttk.Label(self.page, text="Saving pictures, about a minute…")
        progress.pack(anchor="w", pady=6)
        grid = ttk.Frame(self.page)
        grid.pack(fill="both", expand=True)
        buttons = ttk.Frame(self.page)
        buttons.pack(fill="x", pady=(10, 0))

        def work() -> None:
            pictures = core.grab_snapshots(lambda _line: None)

            def show() -> None:
                from PIL import Image, ImageTk

                self.thumbnails = []
                for i, path in enumerate(pictures):
                    image = Image.open(path)
                    image.thumbnail((170, 130))
                    self.thumbnails.append(ImageTk.PhotoImage(image))
                    cell = ttk.Frame(grid)
                    cell.grid(row=i // 4, column=i % 4, padx=4, pady=4)
                    ttk.Label(cell, image=self.thumbnails[-1]).pack()
                    number = int("".join(c for c in path.stem if c.isdigit()) or 0)
                    ttk.Label(cell, text=f"Camera {number:02d}").pack()
                progress.configure(text=f"{len(pictures)} pictures saved.")
                if self.test_only:
                    ttk.Button(buttons, text="Close", command=self.destroy).pack(side="right")
                else:
                    ttk.Button(buttons, text="Next: start the monitoring",
                               command=self.show_finish_setup).pack(side="right")

            self.later(show)

        self.background(work)

    # ── 4. start at boot ─────────────────────────────────────────────────
    def show_finish_setup(self) -> None:
        self.clear("Start automatically")
        text = ("Click Allow, then Yes on the Windows question. This starts the monitoring when the "
                "computer boots, even if nobody logs in, and stops the computer sleeping on mains power.")
        ttk.Label(self.page, text=text, wraplength=700).pack(anchor="w", pady=6)
        live = tk.BooleanVar(value=False)
        ttk.Checkbutton(self.page, text="Enable live view on the website (you will sign in to Tailscale in the browser)",
                        variable=live).pack(anchor="w", pady=6)
        box = self.log_box(10)
        buttons = ttk.Frame(self.page)
        buttons.pack(fill="x", pady=(10, 0))

        def go() -> None:
            for child in buttons.winfo_children():
                child.configure(state="disabled")
            self.background(lambda: self.finish(live.get(), box))

        ttk.Button(buttons, text="Allow", command=go).pack(side="right")

    def finish(self, live: bool, box: tk.Text) -> None:
        core.stop_running_copies()
        self.say(box, "Waiting for the Windows question…")
        result = core.run_elevated(live)
        if result.get("autostart"):
            self.say(box, "Auto-start at boot: done.")
        else:
            core.subprocess.run(["reg", "delete", core.RUN_KEY, "/v", core.RUN_VALUE, "/f"], capture_output=True)
            self.say(box, "Auto-start at boot: SKIPPED (Windows did not allow it). "
                          "The monitoring will start when someone logs in instead.")
        power = result.get("power") or core.try_power_without_admin()
        self.say(box, "Sleep on mains power: turned off." if power
                 else "Sleep on mains power: SKIPPED. Please turn it off in Windows power settings.")
        if live:
            core.enable_live_view(lambda line: self.say(box, line))
        if result.get("autostart"):
            core.subprocess.run(["schtasks", "/run", "/tn", core.TASK_NAME], capture_output=True, **core.NO_WINDOW)
            time.sleep(10)
            if not core.read_task_running():
                self.say(box, "Could not start through the task; starting directly.")
                core.start_now()
        else:
            core.start_at_login_instead()
        self.say(box, "Starting the cameras, this takes up to 4 minutes…")
        deadline = time.monotonic() + WAIT_FOR_CAMERAS_S
        online = total = 0
        status = None
        while time.monotonic() < deadline:
            status = read_status(core.STATUS_PATH)
            online, total = core.cameras_online(status)
            if total and online == total:
                break
            time.sleep(5)
        self.later(lambda: self.show_done(online, total or 8, (status or {}).get("websiteError")))

    def show_done(self, online: int, total: int, website_error) -> None:
        self.clear("Finished")
        ttk.Label(self.page, text=core.final_message(online, total), font=("Segoe UI", 13),
                  wraplength=700).pack(anchor="w", pady=10)
        if website_error:
            ttk.Label(self.page, text="The website has not accepted the camera updates yet. "
                                      "Check the service key.", foreground="#B42318").pack(anchor="w")
        ttk.Button(self.page, text="Close", command=self.destroy).pack(side="bottom", anchor="e")


def main() -> None:
    if "--uninstall" in sys.argv:
        root = tk.Tk()
        root.withdraw()
        if messagebox.askyesno("Uninstall DVS CCTV", "Remove the CCTV software, its settings and saved pictures "
                                                     "from this computer?\nThe DVR is not changed."):
            core.uninstall()
            messagebox.showinfo("Uninstall DVS CCTV", "Removed. If Windows asked and you said No, the start-up "
                                                      "task remains but does nothing.")
        return
    Setup(test_only="--test" in sys.argv).mainloop()


if __name__ == "__main__":
    main()
