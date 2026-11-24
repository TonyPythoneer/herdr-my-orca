# Herdr 錯誤框 column 指向的位置

工具：Herdr.app 0.1.17，`check` 指令（stderr 的 stack trace）。欄位為 1-based UTF-8 byte。
每個樣本的 main.js 第 3 行即為樣本程式碼；第 1-2 行為固定 header。

| # | 樣本 | 回報 (主要 user frame) | 對應 token | 其他 token 位置 (byte) |
|---|------|------------------------|------------|------------------------|
| 1 | `throw new TypeError("A");` | 3:11 | `TypeError` | throw=1, new=7 |
| 2 | `const e = new Error("B"); throw e;` | 3:15 | `Error` (建構處) | new=11, throw=27, e=33 |
| 3 | `const f = () => new Error("C"); throw f();` | 3:21 (第一 frame)；3:39 (第二 frame) | `Error` / 呼叫的 `f` | new=17, throw=33 |
| 4 | `undefinedFn();` | 3:1 | `undefinedFn` | - |
| 5 | `const o = undefined; o.x;` | 3:22 | `o`（member 物件起點） | dot=23, x=24 |
| 6 | `null.y;` | 3:1 | `null`（member 物件起點） | y=6 |
| 7 | `throw "plain string";` | 無 line:col | - | stderr 只有 `String(Ok("plain string"))` |
| 8 | `JSON.parse("{bad");` | 3:6 | `parse`（method 名） | JSON=1, `(`=20 |
| 9 | `  /*中文*/ throw new Error("D");` | 3:24 | `Error` | throw=14 byte / 10 char；Error=20 char |
| 10 | `const q=1;throw new  Error("E");` | 3:22 | `Error` | new=17（new+4 不成立） |

結論（可用於從回報欄位反查程式碼）：
回報的 column 是 V8 掛在「frame 所在執行點」的 token 起點，以 UTF-8 byte 計、1-based。
- `new X(...)`：指向 X（new 之後的第一個 identifier，跳過空白），不是 `new`，也不是 `throw`。
- 一般呼叫 `f()`：指向 callee 的 identifier。
- method 呼叫 `a.b()`：指向 `b`。
- 屬性讀取失敗 `o.x`：指向物件 `o` 的起點，不是 `.` 或 `x`。
- 未定義變數：指向該 identifier 的起點。
- 第 1 行、第 2 行不會出現在回報中（只有 main.js 第 3 行有樣本）。

例外：
1. 丟出非 Error 的值（樣本 7）：沒有 line:col。
2. Error 在別處建立（樣本 2、3）：欄位指向建立 Error 的地方，不是 `throw` 的地方。多 frame 時取第一個 main.js frame。
3. 框架內部 frame（`at parse (native)`、`at <input>:1:1`）沒有 main.js 座標，要取 `main.js?v=1:3:N` 那一行。
4. 非 ASCII：欄位為 byte，不是字元（樣本 9：Error 的 char 欄位 20，回報 24）。
5. 先前假設 "Error 在 new+4" 不成立（樣本 10，兩個空白時是 new+5）。正確規則是「new 之後的 identifier」。

注意：本次只驗證 `check` 輸出的 stack trace，未在 Herdr 錯誤框 UI 上直接觀察（依規則不可執行 status/shot）。
執行備註：第一次執行 s1 時回報 "isolated checker failed ... did not connect"，重試後成功；之後 s1-s10 皆一次成功，與欄位無關。
