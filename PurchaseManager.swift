import StoreKit

@MainActor
final class PurchaseManager: ObservableObject {
    static let productID = "com.umanari0617.RecipeBook.premium_unlock"

    var onUnlocked: (() -> Void)?
    var onRestored: ((Bool) -> Void)?
    var onFailed: ((String) -> Void)?

    /// checkCurrentEntitlement() is called by the web view once the page has loaded, so its callback reaches the JS.
    init() {
        Task { await listenForTransactionUpdates() }
    }

    func checkCurrentEntitlement() async {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result, transaction.productID == Self.productID {
                onUnlocked?()
            }
        }
    }

    func listenForTransactionUpdates() async {
        for await update in Transaction.updates {
            if case .verified(let transaction) = update, transaction.productID == Self.productID {
                await transaction.finish()
                onUnlocked?()
            }
        }
    }

    func purchase() async {
        do {
            let products = try await Product.products(for: [Self.productID])
            guard let product = products.first else {
                onFailed?("商品情報を取得できませんでした。しばらくしてからお試しください。")
                return
            }
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                if case .verified(let transaction) = verification {
                    await transaction.finish()
                    onUnlocked?()
                } else {
                    onFailed?("購入を確認できませんでした。")
                }
            case .userCancelled:
                onFailed?("購入をキャンセルしました。")
            case .pending:
                onFailed?("購入手続き中です。承認されると自動的に反映されます。")
            @unknown default:
                onFailed?("購入処理を完了できませんでした。")
            }
        } catch {
            onFailed?("購入処理でエラーが発生しました。もう一度お試しください。")
        }
    }

    func restore() async {
        do {
            try await AppStore.sync()
            var found = false
            for await result in Transaction.currentEntitlements {
                if case .verified(let transaction) = result, transaction.productID == Self.productID {
                    found = true
                    onUnlocked?()
                }
            }
            onRestored?(found)
        } catch {
            onFailed?("復元処理でエラーが発生しました。もう一度お試しください。")
        }
    }
}
