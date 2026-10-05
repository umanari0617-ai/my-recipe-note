import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
    }
}

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "purchase")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        context.coordinator.webView = webView

        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    @MainActor
    class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        weak var webView: WKWebView?
        let purchaseManager = PurchaseManager()
        private var downloadURLs: [ObjectIdentifier: URL] = [:]

        override init() {
            super.init()
            purchaseManager.onUnlocked = { [weak self] in
                self?.run("onPurchaseUnlocked()")
            }
            purchaseManager.onRestored = { [weak self] found in
                self?.run("onPurchaseRestored(\(found))")
            }
            purchaseManager.onFailed = { [weak self] message in
                let escaped = message.replacingOccurrences(of: "'", with: "\\'")
                self?.run("onPurchaseFailed('\(escaped)')")
            }
        }

        func run(_ js: String) {
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        /// Topmost view controller, used to present alerts and the share sheet.
        private func presenter() -> UIViewController? {
            var vc = webView?.window?.rootViewController
            while let presented = vc?.presentedViewController { vc = presented }
            return vc
        }

        // MARK: - JS bridge

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "purchase",
                  let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }
            Task {
                switch action {
                case "purchase":
                    await purchaseManager.purchase()
                case "restore":
                    await purchaseManager.restore()
                default:
                    break
                }
            }
        }

        // MARK: - Navigation

        /// The page's JS callbacks exist only after load, so the entitlement check waits for it.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { await purchaseManager.checkCurrentEntitlement() }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }
            if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme), navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            if url.isFileURL {
                // Bundled pages (privacy.html / terms.html) open in place; they link back to index.html.
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }

        // MARK: - Backup download → share sheet («ファイルに保存» etc.)

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename)
            try? FileManager.default.removeItem(at: url)
            downloadURLs[ObjectIdentifier(download)] = url
            completionHandler(url)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let url = downloadURLs.removeValue(forKey: ObjectIdentifier(download)),
                  let presenter = presenter() else { return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = presenter.view
            presenter.present(sheet, animated: true)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloadURLs.removeValue(forKey: ObjectIdentifier(download))
        }

        // MARK: - alert / confirm / prompt (WKWebView shows nothing without these)

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            guard let presenter = presenter() else { completionHandler(); return }
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            guard let presenter = presenter() else { completionHandler(false); return }
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
            guard let presenter = presenter() else { completionHandler(nil); return }
            presenter.present(alert, animated: true)
        }
    }
}
