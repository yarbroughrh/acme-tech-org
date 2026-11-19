"""Seed configuration: demo accounts and reference data.

DEMO credentials only, for the workshop demo; documented in README.md. They satisfy the password
policy. In production these accounts would not exist (see docs/PRODUCTION-READINESS.md).
"""

SEED_VERSION = "v1"
RANDOM_SEED = 20261119
PROJECT_COUNT = 120
PEOPLE_COUNT = 150
EXTRA_PM_COUNT = 15

DEMO_ACCOUNTS = [
    {"key": "admin", "email": "admin@acme.example", "display_name": "Avery Admin", "role": "ADMIN", "password": "Beacon!Admin2026"},
    {"key": "pmo", "email": "pmo@acme.example", "display_name": "Morgan Patel", "role": "PMO", "password": "Beacon!Pmo2026"},
    {"key": "pm", "email": "pm@acme.example", "display_name": "Jordan Lee", "role": "PM", "password": "Beacon!Pm2026x"},
    {"key": "member", "email": "member@acme.example", "display_name": "Sam Okafor", "role": "MEMBER", "password": "Beacon!Team2026"},
    {"key": "exec", "email": "exec@acme.example", "display_name": "Taylor Brooks", "role": "EXEC", "password": "Beacon!Exec2026"},
]

DEPARTMENTS = [
    "Digital Channels", "Data & Analytics", "Infrastructure & Cloud", "Cyber Security",
    "Enterprise Applications", "Workplace Technology", "Risk & Compliance Technology",
]

FIRST_NAMES = [
    "Alex", "Bailey", "Casey", "Dana", "Elliot", "Farah", "Gabriel", "Hana", "Imran", "Jamie",
    "Kai", "Lena", "Mateo", "Nadia", "Omar", "Paula", "Quinn", "Rosa", "Sanjay", "Tara",
    "Uma", "Victor", "Wen", "Ximena", "Yusuf", "Zoe", "Aisha", "Ben", "Chloe", "Diego",
    "Emma", "Felix", "Grace", "Hugo", "Isla", "Jonas", "Keira", "Liam", "Maya", "Noah",
]
LAST_NAMES = [
    "Adams", "Baker", "Chen", "Diaz", "Evans", "Fischer", "Garcia", "Hughes", "Ibrahim", "Jensen",
    "Kim", "Lopez", "Murphy", "Nguyen", "Owens", "Park", "Quinn", "Reyes", "Singh", "Turner",
    "Ueda", "Varga", "Walsh", "Xu", "Young", "Zhang", "Ali", "Brown", "Cohen", "Dubois",
]
JOB_TITLES = [
    "Software Engineer", "Senior Software Engineer", "Business Analyst", "Solution Architect",
    "QA Engineer", "Data Engineer", "DevOps Engineer", "UX Designer", "Security Analyst",
    "Scrum Master", "Data Scientist", "Network Engineer",
]

PROJECT_PREFIXES = [
    "Customer", "Payments", "Data", "Cloud", "Identity", "Network", "Mobile", "Analytics",
    "Billing", "Treasury", "Trade", "Compliance", "Workplace", "Service Desk", "API", "Core Banking",
    "Fraud", "Onboarding", "Document", "Reporting",
]
PROJECT_NOUNS = [
    "Platform Migration", "Modernisation", "Portal Upgrade", "Automation", "Consolidation",
    "Resilience Programme", "Integration Hub", "Self-Service", "Decommissioning", "Replatforming",
]
MILESTONE_NAMES = [
    "Discovery complete", "Architecture approved", "Build sprint 1", "Build sprint 2", "Integration testing",
    "UAT sign-off", "Go-live", "Hypercare exit",
]
TASK_VERBS = ["Design", "Build", "Test", "Review", "Document", "Deploy", "Configure", "Validate"]
TASK_OBJECTS = ["API layer", "data model", "access controls", "reports", "batch jobs", "UI flows", "runbooks", "interfaces"]
SPONSORS = ["CIO Office", "COO Office", "CFO Office", "Chief Data Officer", "CISO", "Head of Operations"]
