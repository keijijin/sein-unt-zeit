# OpenShift へのデプロイ

リポジトリルートの `Dockerfile` で静的サイト（nginx:8080）をビルドし、名前空間 `sein-unt-zeit` に配信します。

## 前提

- `oc` がログイン済みで、クラスタに書き込み権限があること
- ビルドコンテキストに `doc/overview`・`web/public/data/*.json` 等が含まれていること（`npm run build` の prebuild で public に同期）

## 初回・マニフェスト更新

```bash
cd /path/to/sein-unt-zeit

oc new-project sein-unt-zeit --display-name="存在と時間 — 読書室" 2>/dev/null || oc project sein-unt-zeit

oc apply -k deploy/openshift
```

## イメージのビルドとロールアウト

```bash
oc project sein-unt-zeit
oc start-build web --from-dir=. --follow
```

成功すると ImageStream `web:latest` が更新され、Deployment `web-app` が再デプロイされます。

## 公開 URL

```bash
oc get route web-app -o jsonpath='https://{.spec.host}{"\n"}'
```

## GitHub 連携

リポジトリ: https://github.com/keijijin/sein-unt-zeit

`main` への push で自動ビルドする場合は、BuildConfig に GitHub webhook を設定します（シークレットはクラスタ側で管理し、リポジトリには含めません）。

```bash
oc describe bc web -n sein-unt-zeit   # Webhook URL の確認
```

## トラブルシュート

- **ImageStream が解決されない**: `deployment.yaml` の `image` を `oc get is web -o jsonpath='{.status.dockerImageRepository}:latest'` の値に差し替える。
- **ビルドがメモリ不足**: ローカルで `podman build -t ... .` し、レジストリへ push して Deployment の `image` を差し替える。
