# Translation glossary

The load-bearing terms, decided once and used consistently across every
message. `scripts/translate-messages.ts` pins this table into each translation
prompt; reviewers enforce it. Change a term here → re-draft the affected keys
(`npm run translate -- --all`) and have the reviewer bless them again.

Note the pairs that differ by **vocabulary**, not just script. That is why
`zh-Hant` is a hand-maintained catalogue and never a character-level conversion
of `zh-Hans`: 登录→登錄 is a real word and the wrong one — Taiwan says 登入.

| en | zh-Hans | zh-Hant | note |
| :-- | :-- | :-- | :-- |
| Tally | Tally | Tally | the app's name is never translated |
| gathering | 聚会 | 聚會 | the recurring meeting — Friday Fellowship, Sunday School |
| one-off | 单次活动 | 單次活動 | a trip, retreat or outing; belongs to no chain of repeats |
| event | 活动 | 活動 | the calendar entry itself, when the kind does not matter |
| series / chain | 系列 | 系列 | a gathering's repeats |
| check in / checked in | 签到 / 已签到 | 簽到 / 已簽到 | the act at the door |
| check out | 签出 | 簽出 | only some ministries do it |
| roster | 名单 | 名單 | who is in the ministry |
| student | 学生 | 學生 | 6th–12th grade; the app also serves children's ministry |
| visitor / new face | 新朋友 | 新朋友 | church register — never 访客 / 訪客, which is a building's guest |
| counselor | 辅导 | 輔導 | church register, not 顾问 / 顧問 |
| core team | 核心同工 | 核心同工 | |
| admin | 管理员 | 管理員 | |
| grade | 年级 | 年級 | Pre-K through 12th |
| allergy / allergies | 过敏 | 過敏 | the label carries it; the roster only records *that* there is one |
| kiosk | 签到台 | 簽到台 | what a parent sees it as, not the hardware |
| label | 名牌 | 名牌 | the printed sticker a child wears |
| printer | 打印机 | 印表機 | vocabulary divergence |
| RSVP | 报名 | 報名 | |
| registration | 登记 | 登記 | what a family fills in at the kiosk |
| review / held | 待审核 | 待審核 | the queue a registration waits in |
| merge | 合并 | 合併 | vocabulary divergence |
| MIA (missed in a row) | 连续缺席 | 連續缺席 | never the English initialism |
| insights | 概览 | 概覽 | the core team's screen |
| release (a student) | 结束跟进 | 結束跟進 | stop chasing them; not 释放 / 釋放 |
| follow up | 跟进 | 跟進 | |
| profile | 个人资料 | 個人資料 | |
| contact | 联系方式 | 聯絡方式 | vocabulary divergence |
| sign in / sign out | 登录 / 退出 | 登入 / 登出 | vocabulary divergence |
| save | 保存 | 儲存 | vocabulary divergence |
| apply | 应用 | 套用 | vocabulary divergence |
| loading | 加载中 | 載入中 | vocabulary divergence |
| undo | 撤销 | 復原 | vocabulary divergence |
| search | 搜索 | 搜尋 | vocabulary divergence |
| export | 导出 | 匯出 | vocabulary divergence |
| settings | 设置 | 設定 | vocabulary divergence |
| Planning Center | Planning Center | Planning Center | a product name; never translated |

Register: parents at the kiosk are addressed as 您 — they are guests in the
lobby and the screen is speaking to them directly. Staff-facing screens use 你.

Never translated: **Tally**, **Planning Center**, student and adult names, event
titles a leader typed, label-template `{{tokens}}`, Material icon names
(`local_fire_department`), backend document ids, and grade values. These are
data, not chrome — see `docs/i18n.md` rule 4.
