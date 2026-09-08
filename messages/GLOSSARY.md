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
| kiosk | 签到台 | 簽到台 | the tablet a parent touches — not the hardware, and not the desk below |
| check-in desk (staffed) | 接待台 | 服務台 | the counter with a person behind it; NEVER 签到台 / 簽到台 |
| label | 名牌 | 名牌 | the printed sticker a child wears |
| printer | 打印机 | 印表機 | vocabulary divergence |
| RSVP | 报名 | 報名 | |
| registration | 登记 | 登記 | what a family fills in at the kiosk |
| review / held | 待审核 | 待審核 | the queue a registration waits in |
| merge | 合并 | 合併 | vocabulary divergence |
| MIA, the count | 连续缺席 | 連續缺席 | never the English initialism |
| stopped coming, the list | 久未出现 | 久未出現 | an observation, not a verdict on a teenager |
| insights | 概览 | 概覽 | the core team's screen |
| no longer expected (at a gathering) | 不再算应到 | 不再預期出席 | see the note below — the two scripts diverge on purpose |
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

The **no longer expected** row is the one place the two catalogues use different
*constructions* rather than different words, and the divergence is grammatical
rather than regional.

The action removes a student from one gathering's expected list. It is not
`release` — no English control says that word; the buttons say "Stop expecting
them" and "No longer expected here", and `release` survives only inside two
consequence sentences as a back-reference. It is not 结束跟进 / 結束跟進 either:
`Release.hintMovedOn` says follow-up *continues* in the moved-on branch, so that
term is false for half the feature. And it is not 不再列入, which wants an object
and reads as removal from the roster beside the neighbouring 从名单移除.

`zh-Hant` takes **不再預期出席**, because 預期 is already how this catalogue
renders English *expect* everywhere else. 預期 is transitive with the expecter as
its subject, so the student must sit in the object slot — 不再預期 {name} 出席,
不再預期 {count} 人出席 — never the subject, or the line says the students
stopped expecting.

`zh-Hans` takes **不再算应到**, because in mainland Mandarin 预期 is forecast
register (比预期久) and the roll-call sense belongs to 应到／实到. 应到 is
lexically passive — "due to arrive" — so the student is the correct subject and
the slot problem does not arise.

Scope is carried by an adverbial in both: 这里不再算应到 /
不再預期出席這場聚會. In `Mia.noLongerExpectedAt` the 在 is load-bearing —
without it the filled `{gathering}` becomes the subject and the line says the
gathering is no longer expected.

Register: parents at the kiosk are addressed as 您 — they are guests in the
lobby and the screen is speaking to them directly. Staff-facing screens use 你.

Never translated: **Tally**, **Planning Center**, student and adult names, event
titles a leader typed, label-template `{{tokens}}`, Material icon names
(`local_fire_department`), backend document ids, and grade values. These are
data, not chrome — see `docs/i18n.md` rule 4.

The kiosk's name questions say 英文. The lobby keyboard is a fixed QWERTY and
the kiosk never focuses a focusable element — that is what lets it avoid the
device's slow native keyboard — so there is no IME on the glass and a Chinese
name cannot be typed there however the question is phrased. English is not a
preference at that step, it is the only thing the keys make; the Chinese
question therefore asks for the English name (英文名字 / 英文姓氏), and naming
the constraint is also what answers it. English needs no such warning, so this
is a deliberate divergence between the locales. Declared and enforced as
`REQUIRED_WORDING` in `src/lib/translationState.ts`.
