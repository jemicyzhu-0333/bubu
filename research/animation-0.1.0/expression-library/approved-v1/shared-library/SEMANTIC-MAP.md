# Current semantic IDs and authored targets

The stable public ID is the exact string in the first column, including leading zeros. Chinese labels describe the principal static reading, not a promise that a face alone communicates every action. The mapper accepts no implicit aliases.

| ID | Main reading | Source group | Eight target names |
|---|---|---|---|
| `R0` | 安静短横嘴 | batch2 | `BasicR0_01` … `BasicR0_08` |
| `D1` | 清醒但疲惫 | batch1 | `BasicD1_01` … `BasicD1_08` |
| `A7` | 自然睡眠 | batch2 | `BasicA7_01` … `BasicA7_08` |
| `D4` | 哈欠经过 | batch4 | `BasicD4_01` … `BasicD4_08` |
| `01` | 好奇／轻惊 | r6 | `Face01_01` … `Face01_08` |
| `N2` | 疑惑 | batch1 | `BasicN2_01` … `BasicN2_08` |
| `N3` | 强惊讶，小口内舌色 | batch3 | `BasicN3_01` … `BasicN3_08` |
| `T05` | 轻微不安／绷住注意，新版05 | batch3 | `BasicT05_01` … `BasicT05_08` |
| `07` | 开心笑眼开口 | r6 | `Face07_01` … `Face07_08` |
| `P2` | 安静满足 | batch1 | `BasicP2_01` … `BasicP2_08` |
| `08` | 半睑放松微笑 | r6 | `Face08_01` … `Face08_08` |
| `A4` | 认真／严肃专注 | batch4 | `BasicA4_01` … `BasicA4_08` |
| `04` | 短暂使劲挤眼 | r6 | `Face04_01` … `Face04_08` |
| `A8` | 不耐烦 | batch4 | `BasicA8_01` … `BasicA8_08` |
| `S2` | 自然友好，愿意回应 | batch2 | `BasicS2_01` … `BasicS2_08` |
| `S3` | 忧虑 | batch5 | `BasicS3_01` … `BasicS3_08` |
| `T5` | 闭眼失落 | batch5 | `BasicT5_01` … `BasicT5_08` |
| `S5` | 睁眼失落 | batch5 | `BasicS5_01` … `BasicS5_08` |

## Contract distinctions

- `None,0` means the unchanged all-zero small-O Basis. `R0,1` is a distinct short-line neutral face.
- Reference revision05 maps only to `T05`. Bare `05` is rejected. Historical `Face05_*` is not in the current library.
- `T5` and `T05` are unrelated exact IDs; never normalize away the zero.
- D4 is a yawn passage, not an indefinitely held sleep state. T5/S5 are two states in one sadness family.
- A4/D1 and P2/A7 remain genuine neighboring looks. They are not counted as wholly different emotions merely because their IDs differ.
- S2 is friendly availability; expectation/request requires gaze, context and body action. Independent gaze is not implemented here.
- All eight layers receive the same selected-state adjacent-knot weights. Per-layer independent semantic choice is forbidden.
- Full18 gold is the static/recovery library. The seven-state slice permits only 04,N3,A7,07,S5,R0,N2 within its separate runtime purpose.
