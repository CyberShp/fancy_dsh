import AppKit
import WebKit
import Darwin

private struct LaunchOptions {
    let url: URL
    let timeout: TimeInterval
    let stay: Bool

    static let usage = """
    Usage: NormandyWindow http://127.0.0.1:PORT/cinematic/?launch=TOKEN
           NormandyWindow URL [--stay] [--test-timeout SECONDS]

    The window closes when the sequence completes or the user presses Escape.
    --stay keeps the DSH window open after startup and passes Escape to the page.
    --test-timeout shortens the 45-second watchdog for local testing.
    """

    static func parse(_ arguments: [String]) -> LaunchOptions? {
        guard !arguments.isEmpty,
              let components = URLComponents(string: arguments[0]),
              components.scheme == "http", components.host == "127.0.0.1",
              components.user == nil, components.password == nil,
              let url = components.url,
              (1...65535).contains(components.port ?? 80) else { return nil }
        var timeout: TimeInterval = 45
        var stay = false
        var hasTimeout = false
        var index = 1
        while index < arguments.count {
            switch arguments[index] {
            case "--stay":
                guard !stay else { return nil }
                stay = true
                index += 1
            case "--test-timeout":
                guard !hasTimeout, index + 1 < arguments.count,
                      let value = TimeInterval(arguments[index + 1]), value.isFinite,
                      value >= 0.1, value <= 45 else { return nil }
                timeout = value
                hasTimeout = true
                index += 2
            default: return nil
            }
        }
        return LaunchOptions(url: url, timeout: timeout, stay: stay)
    }
}

@MainActor
private final class NormandyApplication: NSObject, NSApplicationDelegate,
    NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let options: LaunchOptions
    private var window: NSWindow?
    private var webView: WKWebView?
    private var keyMonitor: Any?
    private var watchdog: Timer?
    private var finished = false
    private var startupFinished = false
    private(set) var result: Int32 = 0

    init(options: LaunchOptions) { self.options = options }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = options.stay ? .default() : .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(self, name: "normandy")

        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(1440, visible.width * 0.9, visible.height * 0.9 * 1.6)
        let size = NSSize(width: width, height: width / 1.6)
        let frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: frame,
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = options.stay ? "DSH · Normandy" : "Normandy · Command Sequence"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 2 / 255, green: 9 / 255, blue: 18 / 255, alpha: 1)
        window.contentAspectRatio = NSSize(width: 16, height: 10)
        window.contentMinSize = NSSize(width: 768, height: 480)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.collectionBehavior = [.fullScreenPrimary]
        window.center()
        self.window = window

        let webView = WKWebView(frame: frame, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = window.backgroundColor }
        window.contentView = webView
        self.webView = webView

        let menu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Close Normandy", action: #selector(closeSequence), keyEquivalent: "w").target = self
        appMenu.addItem(withTitle: "Quit Normandy", action: #selector(closeSequence), keyEquivalent: "q").target = self
        appMenuItem.submenu = appMenu
        menu.addItem(appMenuItem)
        let editMenuItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                    ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editMenuItem.submenu = editMenu
        menu.addItem(editMenuItem)
        NSApp.mainMenu = menu

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 && self?.options.stay == false {
                self?.finish(code: 0, event: "skip")
                return nil
            }
            return event
        }
        watchdog = Timer.scheduledTimer(timeInterval: options.timeout, target: self,
                                        selector: #selector(startupTimedOut), userInfo: nil, repeats: false)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(webView)
        webView.load(URLRequest(url: options.url, cachePolicy: .reloadIgnoringLocalCacheData,
                               timeoutInterval: min(15, options.timeout)))
    }

    private func sameOrigin(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1"
            && (url.port ?? 80) == (options.url.port ?? 80)
            && url.user == nil && url.password == nil
    }

    private func finish(code: Int32, event: String) {
        guard !finished else { return }
        finished = true
        result = code
        watchdog?.invalidate()
        if let keyMonitor = keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "normandy")
        window?.orderOut(nil)
        print("NORMANDY_EVENT \(event)")
        fflush(stdout)
        NSApp.stop(nil)
        // Wake the application loop so a callback can return its exit status promptly.
        if let wake = NSEvent.otherEvent(with: .applicationDefined, location: .zero,
                                        modifierFlags: [], timestamp: 0, windowNumber: 0,
                                        context: nil, subtype: 0, data1: 0, data2: 0) {
            NSApp.postEvent(wake, atStart: true)
        }
    }

    @objc private func closeSequence() { finish(code: 0, event: "skip") }
    @objc private func startupTimedOut() { finish(code: 124, event: "timeout") }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        finish(code: 0, event: "skip")
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        finish(code: 0, event: "skip")
        return .terminateCancel
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "normandy", message.webView === webView,
              (options.stay || message.frameInfo.isMainFrame), sameOrigin(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let event = body["event"] as? String else { return }
        switch event {
        case "ready":
            if options.stay {
                watchdog?.invalidate()
                print("NORMANDY_EVENT ready")
                fflush(stdout)
            }
        case "complete", "skip", "error":
            if options.stay {
                guard !startupFinished else { return }
                startupFinished = true
                watchdog?.invalidate()
                print("NORMANDY_EVENT \(event)")
                fflush(stdout)
            } else {
                finish(code: event == "error" ? 1 : 0, event: event)
            }
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if options.stay, navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url, url.scheme == "https", url.host != nil,
           url.user == nil, url.password == nil {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(navigationAction.targetFrame != nil && sameOrigin(navigationAction.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let valid = sameOrigin(navigationResponse.response.url)
            && ((navigationResponse.response as? HTTPURLResponse)?.statusCode ?? 200) < 400
        decisionHandler(valid ? .allow : .cancel)
        if !valid && navigationResponse.isForMainFrame { finish(code: 1, event: "error") }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }

    private func navigationFailed(_ error: Error) {
        let error = error as NSError
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
        finish(code: 1, event: "error")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(code: 1, event: "error") }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        return nil
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["--help"] {
    print(LaunchOptions.usage)
    exit(0)
}
guard let options = LaunchOptions.parse(arguments) else {
    FileHandle.standardError.write(Data((LaunchOptions.usage + "\n").utf8))
    exit(64)
}
MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = NormandyApplication(options: options)
    application.setActivationPolicy(.regular)
    application.delegate = delegate
    application.run()
    exit(delegate.result)
}
