# Translation glossary

The load-bearing terms, decided once and used consistently across every
message. `scripts/translate-messages.ts` pins this table into each translation
prompt; reviewers enforce it. Change a term here → re-draft the affected keys
(`npm run translate -- --all`) and have the reviewer bless them again.

## How we translate: dynamic equivalence

**The unit of translation is the job the string does, not the words it is made
of.** Nida's distinction: a *formally* equivalent translation reproduces the
source's forms, and a *dynamically* equivalent one reproduces its effect on the
person reading it. Everything in `messages/` is UI, and a UI string's effect is
almost never its dictionary meaning — it is *a volunteer glances at a chip and
knows what it filters*, or *a mother at a kiosk reads one line and knows what to
touch*. Translate that.

In practice, five questions, in this order:

1. **What does this do for the reader?** A button, a chip, a status, a
   reassurance, a refusal. Then: what would a Spanish or Chinese app already say
   in that slot? That string is the translation. `Check in` beside a student's
   name is *Registrar* — not *Registrar la entrada de*, which is the dictionary
   answer and twenty-two characters wide.
2. **Does it stay the same size class?** A chip must read as a chip and a button
   as a button. English is unusually terse and the target language will not be
   terse by accident: use its own compression — Spanish drops articles and
   prefers a noun phrase to a sentence (*Kiosco sin impresora*, not *Este kiosco
   no tiene ninguna impresora*), Chinese drops the plural branches and the
   copula (*已签到*, not a clause). The check-in filter row fits three chips at
   412 px and not one character more.
3. **Does it carry exactly the facts the English carries?** This is the hard
   line, and it is what keeps dynamic equivalence from becoming licence. Change
   the form freely; never add a fact or drop one. A draft of `Auth.inactiveBody`
   once rendered *An admin switched off this account's access* as 你在 Tally 的
   权限已经被关闭。Planning Center 上仍然有你，但核心同工把你标记为停用了 — a
   second sentence about Planning Center that no English string contains, naming
   the wrong people as having done it. Fluent, confident, and false.
4. **Is the register right?** *usted* and 您 at the lobby kiosk, *tú* and 你 in
   the staff app. See the sections below.
5. **Does it obey the glossary?** The table wins over a better-sounding word.
   Consistency across two thousand strings is itself part of the effect.

The `context` note on each key in `messages/translation-state.json` exists to
answer question 1, and is the most valuable thing in the pipeline. A key with no
context gets a literal translation, because a literal translation is all anybody
— model or human — can produce from a word alone.

Note the pairs that differ by **vocabulary**, not just script. That is why
`zh-Hant` is a hand-maintained catalogue and never a character-level conversion
of `zh-Hans`: 登录→登錄 is a real word and the wrong one — Taiwan says 登入.

| en | es-MX | zh-Hans | zh-Hant | note |
| :-- | :-- | :-- | :-- | :-- |
| Tally | Tally | Tally | Tally | the app’s name is never translated |
| gathering | reunión | 聚会 | 聚會 | the recurring meeting — Friday Fellowship, Sunday School |
| one-off | actividad única | 单次活动 | 單次活動 | a trip, retreat or outing; belongs to no chain of repeats |
| event | evento | 活动 | 活動 | the calendar entry itself, when the kind does not matter |
| series / chain | serie | 系列 | 系列 | a gathering's repeats |
| check in / checked in | registrar la entrada / ya llegó | 签到 / 已签到 | 簽到 / 已簽到 | the act at the door, and the state. See the note below: the state is said with *llegar* |
| check out | registrar la salida | 签出 | 簽出 | only some ministries do it |
| roster | lista | 名单 | 名單 | who is in the ministry |
| student | estudiante | 学生 | 學生 | 6th–12th grade; the app also serves children's ministry |
| visitor / new face | visita | 新朋友 | 新朋友 | church register, warm — **never *visitante***, which is a guest of the building |
| counselor | líder | 辅导 | 輔導 | the adult who runs a gathering. **Never *consejero*** — that is a therapist or a board member |
| core team | equipo central | 核心同工 | 核心同工 |  |
| admin | administrador | 管理员 | 管理員 |  |
| grade | grado | 年级 | 年級 | the **US** ladder these children actually attend — 6.º grado … 12.º grado. Never *secundaria* / *preparatoria* |
| allergy / allergies | alergia / alergias | 过敏 | 過敏 | the label carries it; the roster only records *that* there is one |
| kiosk | kiosco | 签到台 | 簽到台 | a self-service terminal. Spelled *kiosco*, as Mexico writes it, not *quiosco* |
| check-in desk (staffed) | mesa de registro | 接待台 | 服務台 | the counter with a person behind it; NEVER *kiosco* |
| label | etiqueta | 名牌 | 名牌 | the printed sticker a child wears |
| printer | impresora | 打印机 | 印表機 | vocabulary divergence |
| RSVP | confirmar asistencia | 报名 | 報名 |  |
| registration | inscripción | 登记 | 登記 | what a family fills in at the kiosk — enrolling, not arriving |
| review / held | por revisar | 待审核 | 待審核 | the queue a registration waits in |
| merge | combinar | 合并 | 合併 | vocabulary divergence |
| MIA, the count | faltas seguidas | 连续缺席 | 連續缺席 | *faltas* is what a school report says here; never an initialism |
| stopped coming, the list | dejaron de venir | 久未出现 | 久未出現 | an observation, not a verdict on a teenager |
| insights | resumen | 概览 | 概覽 | the core team’s screen |
| no longer expected (at a gathering) | ya no se espera | 不再算应到 | 不再預期出席 | see the note below — the two scripts diverge on purpose |
| follow up | seguimiento | 跟进 | 跟進 |  |
| profile | perfil | 个人资料 | 個人資料 |  |
| contact | contacto | 联系方式 | 聯絡方式 | vocabulary divergence |
| sign in / sign out | iniciar sesión / cerrar sesión | 登录 / 退出 | 登入 / 登出 | vocabulary divergence |
| save | guardar | 保存 | 儲存 | vocabulary divergence |
| apply | aplicar | 应用 | 套用 | vocabulary divergence |
| loading | cargando | 加载中 | 載入中 | vocabulary divergence |
| undo | deshacer | 撤销 | 復原 | vocabulary divergence |
| search | buscar | 搜索 | 搜尋 | vocabulary divergence |
| export | exportar | 导出 | 匯出 | vocabulary divergence |
| settings | configuración | 设置 | 設定 | never *ajustes*, which is peninsular |
| Planning Center | Planning Center | Planning Center | Planning Center | a product name; never translated |

The **no longer expected** row is the one place the catalogues use different
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

`es-MX` takes **ya no se espera** and reaches the same place by a third route.
Spanish would force this line to say whether the student is a girl or a boy —
*ya no lo esperamos* / *ya no la esperamos* — and the app does not know. The
impersonal *se* removes the subject, the personal *a* keeps the student in the
object slot, and the whole sentence comes out with no gender in it at all:
**ya no se espera a {name} aquí**, **ya no se espera a {count} estudiantes**.
The control that does it is **Dejar de esperar**, an infinitive, for the same
reason.

## Spanish has two things English does not, and both reach the screen

**Gender.** English is silent about it and Spanish cannot be. Almost everything
this app says about a person sits beside that person's name — a chip on a
student's row, a toast about them, the line under their photograph — and their
gender is not a field Tally holds. So the catalogue never writes a participle or
an adjective about a student:

- *checked in* is **ya llegó**, never *registrado* / *registrada*. The state is
  said with **llegar** and the act with **registrar la entrada**; the table
  above carries both because they are two different words in Spanish and one in
  English.
- *checked out* is **ya se fue**, never *registrado de salida*.
- a role or a description takes a noun that does not inflect — **estudiante**,
  **líder**, **visita**, **la persona** — rather than one that does.

A masculine plural over a mixed group (*12 registrados*) is ordinary Spanish and
is allowed where the string is genuinely about a count. A masculine singular
over one unknown child is not, and is the thing to catch in review.

**Address.** *usted* at the lobby kiosk, *tú* inside the app — exactly the split
`zh-Hans` and `zh-Hant` make with 您 and 你, and for the same reason. A family
at the kiosk is a guest being spoken to directly, and in this lobby *usted* to a
parent is not formality, it is courtesy. Staff are colleagues on a Sunday
morning and *tú* to them is not sloppiness, it is not standing on ceremony. The
imperative changes with it: **Toque** on the glass, **toca** in the app. The
pairs in `DELIBERATELY_UNPINNED` exist so the two can differ.

**Terse, the way a Spanish UI is terse.** Spanish runs 20–25% longer than
English by nature, and this app spends that budget on a lobby tablet and on a
phone held at a door — the check-in filter row fits three chips at 412px and not
one character more. So the catalogue follows the conventions Spanish interfaces
already use, rather than translating English's short phrasing into full Spanish
clauses:

- **A noun phrase, not a sentence.** *Kiosco sin impresora*, not *Este kiosco no
  tiene ninguna impresora*. *Registro abierto*, not *El registro está abierto*.
- **Drop the verb *to be* in short lines.** *Comando no disponible*, not *El
  comando no está disponible*.
- **Drop the article a label can live without.** *Guardar cambios*, *Borrar
  búsqueda*, *Copiar número*, *Quitar filtros* — never *Guardar los cambios*.
- **The act is *registrar*; *entrada* only earns its place beside *salida*.**
  *Registrar a {name}*, not *Registrar la entrada de {name}* — which was twenty-
  two characters where English spends eight.
- **Retry is *Prueba otra vez* in a sentence and *Reintentar* on a button**, not
  *Inténtalo de nuevo*.
- ***Cannot / Could not* is *No se puede / No se pudo* + infinitive**, with the
  stress on the action rather than on who failed. *Failed to* is *Error al* —
  never *falló*.
- **No *por favor*, and English's exclamation marks do not transfer.**

These are the Microsoft Spanish (Mexico) style guide's own rules, and the pass
that applied them brought the short strings — everything 44 characters or under,
which is where width actually bites — from 1.24× the English to 1.14×. Screen-
reader strings (`*Aria`, `*Label`, `spoken*`) are exempt: nothing there is
competing for pixels, and clarity wins.

**Never peninsular.** No *vosotros*, no *ordenador*, no *móvil*, no *ajustes*,
no *coger*. The plural *you* is **ustedes** everywhere.

**Mexican, but not only Mexican.** Three families in four here are of Mexican
origin and most of the rest are Salvadoran or Guatemalan, so where the region
agrees the word is the Mexican one (*computadora*, *celular*, *configuración*,
*eliminar*) and where Mexico is alone the catalogue takes the neutral Latin
American form. Rejected on exactly that ground: *checar* (for *revisar*),
*platicar* (for *hablar*), *¿mande?*, *chamaco*, *gafete* (for *etiqueta*) and
*padrísimo*. None is wrong in Mexico; each is a small sign to a Salvadoran
mother that the screen was not written for her.

Register: parents at the kiosk are addressed as 您 and *usted* — they are guests
in the lobby and the screen is speaking to them directly. Staff-facing screens
use 你 and *tú*.

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

**Spanish hit the same keyboard and was answered on the glass instead**, so it
has no `REQUIRED_WORDING` entry and the questions say nothing about spelling.
The lobby board grows an **Ñ** key when the kiosk is set to Spanish, because Ñ
is a letter and not an accent: Muñoz written *Munoz* is a different surname on a
child's sticker and in the church's database. The accented vowels are left out —
*José* written *Jose* is the same name with a mark dropped, which is what most
US forms this family has already filled in say, and `normalizeForSearch` folds
the marks so Ramírez is still found by typing RAMIREZ. See
`src/kiosk/components/Keyboard.tsx`, where the row arithmetic that makes the Ñ
free is written down.
