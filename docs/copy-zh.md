# The Chinese copy standard

`docs/copy.md` is the standard the English is held to. This is its counterpart
for the two Chinese catalogues, and it exists because the English standard does
not survive translation: "keep it short" means something different in a script
where four characters are a full sentence, and "use the active voice" is advice
about a distinction Chinese marks differently.

Written before the Traditional and Simplified reviewers read the catalogues, so
that their findings could be argued against something rather than traded as
opinion. Sources are named where a rule is somebody else's; the rest are this
app's own decisions and say so.

---

## Who is reading

The same split the English standard makes, doubled:

| | Traditional (`zh-Hant`) | Simplified (`zh-Hans`) |
| :-- | :-- | :-- |
| **the lobby** | a parent in a Taipei church foyer, holding a toddler | a parent in a mainland church foyer, same hands full |
| **the office** | a Taiwanese children's-ministry director on a Tuesday | her mainland counterpart |
| **the door** | a Taiwanese youth 輔導 with a queue in front of them | a mainland 辅导, same queue |

A reader of one catalogue never sees the other. That is what makes the two
files independent documents rather than one file and a conversion of it.

---

## Rule 1 — the two catalogues differ by vocabulary, not only by script

`zh-Hant` is not `zh-Hans` run through a character converter, and the failure
that proves it is 登录 → 登錄: a real word, correctly converted, and the wrong
one, because Taiwan says 登入.

`messages/GLOSSARY.md` holds the pairs this app has already decided. Every one
of them is a word a converter gets wrong: 保存/儲存, 搜索/搜尋, 设置/設定,
加载/載入, 导出/匯出, 撤销/復原, 合并/合併, 联系方式/聯絡方式, 应用/套用,
打印机/印表機.

A term in the glossary is not a suggestion. Changing one changes it everywhere.

## Rule 2 — punctuation is full-width, and the quotation marks differ

Inside a Chinese sentence the punctuation is Chinese: ，。！？、；：, never the
ASCII `,.!?;:`. A Latin sentence quoted whole keeps its own half-width marks.

The quotation marks are **not** shared between the two catalogues:

- `zh-Hant` uses 「」, and 『』 inside them.
- `zh-Hans` uses “ ”, and ‘ ’ inside them (GB/T 15834).

Never a straight `"`. Never repeated punctuation (`！！！`). Never a space
before a full-width mark — it carries its own.

*(Sources: [中文文案排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines);
[W3C 中文排版需求](https://www.w3.org/TR/clreq/).)*

## Rule 3 — a space between Chinese and Latin, and between Chinese and digits

`12 年级`, `Google 登录`, `{count} 位学生` — not `12年级` or `Google登录`.

The catalogue already does this in 227 strings, so the rule is descriptive
rather than aspirational; what it is for is the next string somebody adds.

Two exceptions, both because the convention is older than the rule: a date
written `8月9日`, and a percent or degree sign, which attach directly (`15%`).

## Rule 4 — the kiosk says 您; staff screens say 你

A parent in the lobby is a guest and is addressed as a guest. A counselor is a
colleague, and 您 to a colleague reads as distance rather than respect.

This is a deliberate divergence from Microsoft's Traditional Chinese guide,
which tells localisers to use 您 everywhere. That advice is written for products
sold to strangers; half of this one is used by the same eight people every
Friday.

The exception inside the exception: `Pairing.*` lives in a kiosk namespace but
is a job a volunteer does to a tablet, not something a parent reads. It takes 你.

## Rule 5 — do not assign a gender the English did not

The English says *they* throughout, because a student is a child whose name the
app knows and whose gender it does not record.

Chinese has no neutral third person in common written use. 他 as a generic is
traditional and is still what most style guides fall back on, and it is also a
sentence telling a girl's counselor "he". The order of preference here:

1. **Drop the pronoun.** Chinese does this comfortably where English cannot —
   《他会离开这份名单》 becomes 《会离开这份名单》 and loses nothing.
2. **Repeat the noun** — 这位学生, 这个孩子 — where dropping it would strand
   the sentence.
3. 他／她 only where a sentence genuinely needs both and can carry the width.

Never 它 for a person. Avoid TA and X也: they are internet register, and this
screen is read by a sixty-year-old volunteer.

## Rule 6 — translationese is the failure mode, and it has three shapes

A sentence that is accurate and still reads as translated. The three that
actually appear here:

- **的的不休.** More than one 的 in a short phrase. 你的学生的名单 → 学生名单.
- **Imported pronouns.** English needs *your*; Chinese usually does not.
  "your students" is 学生, not 你的学生, unless ownership is the point.
- **被 where nothing was done to anybody.** 被签到 is not how a check-in is
  described; 已签到 is.

## Rule 7 — a button is a verb, and four characters is a long one

Chinese is dense: 保存, 签到, 结束跟进 are a whole button each. English button
labels that ran to five words become two characters, and the temptation is then
to add words back. Don't — the space is a gift, not a vacancy.

Where the English button completes "I want to…", the Chinese one completes
《我要…》. An adjective phrase completes neither.

## Rule 8 — the measure word has to match the noun

The commonest way a fluent sentence announces it was written by a foreigner.
In this app: 场/場 for a gathering, 位 for a person addressed with respect, 个/個
for a student in a count, 台 for a tablet or printer, 张/張 for a printed label,
份 for a roster or list.

## Rule 9 — never translate the data

**Tally**, **Planning Center**, student and adult names, event titles a leader
typed, label-template `{{tokens}}`, Material icon names, backend ids and grade
values are data. A translated grade value does not match the grade the roster
stores, and a translated icon name resolves to no icon.

## Rule 10 — an ICU message is one sentence, in one piece

A count, a name or a date is a *value*. A verb phrase is not. Splitting a
sentence so that half of it arrives as an argument produces a sentence Chinese
cannot reorder — and reordering is exactly what Chinese does to it.

Chinese has one plural category, so `{count, plural, one {…} other {…}}`
collapses to `other`. The one place it must not is where the `one` branch
carries an argument the `other` branch lacks; there it keeps an explicit `=1`.
`Review.yesAddChildren` is the only such key, and `messageArguments` in
`src/lib/translationState.ts` is what stops a fourth from appearing quietly.

## Rule 11 — the kiosk's name questions ask for 英文, and must keep saying so

The lobby keyboard is a fixed Latin QWERTY with no IME, so a Chinese name
cannot be typed at that step however the question is phrased. The Chinese
question therefore asks for the English name — 英文名字, 英文姓氏 — and naming
the constraint is what answers it.

Six `Register.*` keys are pinned to this by `REQUIRED_WORDING` in
`src/lib/translationState.ts`, in both scripts. The English is deliberately free
of it: an English reader has no such problem.

---

## What this standard cannot do

Every value in both catalogues is marked `machine` in
`messages/translation-state.json`, and none is `reviewed`. A standard is not a
reviewer. The keys become `reviewed` when a bilingual human has read them —
which is a different event from any of the passes described here, and it has
not happened yet.
