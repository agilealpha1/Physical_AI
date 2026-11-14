# Physical AI Radar

論文・コード・動作条件をまとめて探せる、Physical AI の技術カタログです。

**公開サイト:** https://agilealpha1.github.io/Physical_AI/

[![Deploy](https://github.com/agilealpha1/Physical_AI/actions/workflows/pages.yml/badge.svg)](https://github.com/agilealpha1/Physical_AI/actions/workflows/pages.yml)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Data: CC0](https://img.shields.io/badge/data-CC0%201.0-lightgrey.svg)](DATA_LICENSE.md)

## できること

- カテゴリや用途から技術を検索・絞り込み
- OS、GPU、VRAM、対応ロボットなどの動作条件を確認
- シミュレーション、実機評価、再現手順の有無を確認
- 最大 4 件を比較し、学習パスから次に試す技術を探す

不明な情報は推測せず「未確認」と表示します。コード、モデル重み、データのライセンスはそれぞれ異なるため、利用前に公式情報を確認してください。

## 掲載データについて

カタログには 111 件を掲載しています。初版の 47 件に加え、[Awesome Physical AI](https://github.com/keon/awesome-physical-ai) から 64 件を追加しました。追加分は GitHub リポジトリの存在を確認した段階で、動作条件・検証状況・ライセンスは未確認です。GitHub のスター数なども、取得できていない項目があります。

## ローカルで実行

Python 3.10 以上が必要です。

```bash
git clone https://github.com/agilealpha1/Physical_AI.git
cd Physical_AI

python3 -m venv .venv
source .venv/bin/activate
make install

make check
make serve
```

サイトは http://localhost:8000/ で開きます。`make check` はテスト、データ検証、サイト生成を実行します。

## データの更新

GitHub のスター数や更新日を手動で取得するには:

```bash
export GITHUB_TOKEN="$(gh auth token)"  # 任意。API の利用制限を緩和
make refresh
make build
```

GitHub Actions も毎週データを更新し、サイトを再公開します。取得に失敗した場合は、前回のデータを使って公開を続けます。

## 掲載内容の修正

1. `data/projects.jsonl` の対象行を追加・編集します（1 行につき 1 件）。
2. 必要に応じて `data/paths.json` の学習パスも更新します。
3. `make check` で検証し、`make build` 後に表示を確認します。
4. 変更を Pull Request で提案してください。

不明な値は空欄や推測で補わず、既存データの形式に従って「未確認」としてください。

## 公開

`main` ブランチへの push で GitHub Actions がビルド・公開します。

https://agilealpha1.github.io/Physical_AI/

## ライセンス

- サイトのコード: [MIT](LICENSE)
- キュレーションデータ: [CC0 1.0](DATA_LICENSE.md)
- 掲載プロジェクトのコード、重み、データ: 各プロジェクトのライセンスに従います
