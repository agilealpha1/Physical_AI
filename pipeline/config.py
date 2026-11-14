"""Physical AI Radar の分類・表示ラベル・サイト設定。"""

SITE_NAME = "Physical AI Radar"
SITE_TAGLINE = "論文・実装・動作条件を、ひとつの地図に。"
SITE_DESC = (
    "Physical AI の論文・実装・動作条件を横断できる技術カタログ。"
    "ロボット学習、VLA、認識、シミュレーション、データセット、エッジ実装を、"
    "公式情報と「未確認」の区別つきで整理する。"
)
REPO_URL = "https://github.com/agilealpha1/Physical_AI"
DEFAULT_BASE = "https://agilealpha1.github.io/Physical_AI/"
SCHEMA_VERSION = 1

CATEGORIES = [
    {
        "id": "robot-learning",
        "label": "ロボット学習・VLA",
        "en": "Robot Learning / VLA",
        "color": "#5eead4",
        "description": "行動学習・模倣学習・強化学習、画像と言語から行動を出す VLA モデル。",
    },
    {
        "id": "perception",
        "label": "認識・世界モデル",
        "en": "Perception / World Models",
        "color": "#93c5fd",
        "description": "環境認識、3D 理解、物体検出、将来状態の予測。ロボットの目と想像力。",
    },
    {
        "id": "simulation",
        "label": "シミュレーション・Sim2Real",
        "en": "Simulation / Sim-to-Real",
        "color": "#c4b5fd",
        "description": "物理シミュレータ、学習環境、実機への転移。実機の前に試行錯誤するための基盤。",
    },
    {
        "id": "data-eval",
        "label": "データセット・評価",
        "en": "Datasets / Evaluation",
        "color": "#fcd34d",
        "description": "ロボットデータ、ベンチマーク、評価環境。手法を同じ条件で比べるための土台。",
    },
    {
        "id": "deployment",
        "label": "実装・エッジ",
        "en": "Deployment / Edge",
        "color": "#fda4af",
        "description": "実行環境、推論最適化、ロボット接続。研究コードを実機・車載・エッジへ運ぶ。",
    },
]

USES = [
    {"id": "arm", "label": "ロボットアーム", "en": "Robot arm"},
    {"id": "humanoid", "label": "ヒューマノイド", "en": "Humanoid"},
    {"id": "mobile", "label": "移動ロボット", "en": "Mobile robot"},
    {"id": "driving", "label": "自動運転", "en": "Autonomous driving"},
    {"id": "warehouse", "label": "倉庫・物流", "en": "Warehouse / logistics"},
    {"id": "cross", "label": "横断・基盤", "en": "Cross-domain"},
]

STATUS_LABELS = {
    "active": "活発",
    "maintenance": "保守中心",
    "archived": "アーカイブ",
    "unknown": "活動状況未確認",
}

REQ_STATUS_LABELS = {
    "official": "公式確認",
    "community": "コミュニティ情報",
    "unknown": "未確認",
    "na": "該当なし",
}

SIM_LABELS = {
    "reported": "シミュレーション評価あり",
    "not_reported": "シミュレーション評価の記載なし",
    "na": "該当なし",
    "unknown": "未確認",
}
REAL_LABELS = {
    "vendor": "開発元が実機評価",
    "third_party": "第三者・コミュニティが実機評価",
    "community": "コミュニティの実機例",
    "not_reported": "実機評価の記載なし",
    "na": "該当なし",
    "unknown": "未確認",
}
REPRO_LABELS = {
    "official": "公式コード・手順あり",
    "third_party": "第三者による再現報告あり",
    "not_reported": "再現手順の記載なし",
    "na": "該当なし",
    "unknown": "未確認",
}

# 掲載基準の要約（About と README で共用）
INCLUSION = [
    "Physical AI の研究・実装・運用に直接関係する公式プロジェクトであること。",
    "GitHub リポジトリ、論文、ドキュメントのうち、公式の一次情報が確認できること。",
    "スター数は掲載条件にしない。並び替えと参考指標としてのみ使う。",
    "不明な項目は推測で埋めず「未確認」と表示する。",
]
