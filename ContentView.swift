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
        context.coordinator.webView = webView

        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        let purchaseManager = PurchaseManager()

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
            DispatchQueue.main.async {
                self.webView?.evaluateJavaScript(js, completionHandler: nil)
            }
        }

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

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }
    }
}
