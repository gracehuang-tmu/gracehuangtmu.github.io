# 飲料團購點餐

網址：https://gracehuang-lab.com/drink/

- 前端：`index.html`、`app.js`（GitHub Pages 靜態網頁，同事不需登入）
- 菜單：`menu.json`
- 後端：`apps-script/Code.gs`（Google Apps Script，訂單寫入團主的 Google 試算表）
- 設定：`config.js` 放 Apps Script 網頁應用程式網址

## 第一次設定（約 5 分鐘）

1. 到 https://script.google.com 建立新專案，把 `apps-script/Code.gs` 全部貼上並儲存。
2. 上方函式選單選 `setup`，按「執行」，依提示授權。
   執行紀錄會顯示「試算表網址」與「團主密碼」，請記下團主密碼。
3. 右上「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」
   - 執行身分：我
   - 誰可以存取：所有人
4. 按「部署」，複製網頁應用程式網址（`https://script.google.com/macros/s/.../exec`），填入 `config.js`。

## 使用

- 同事：開網址 → 輸入名字 → 點飲料，自動送出，可隨時修改自己的訂單。
- 團主：「全部彙整」頁底按「團主登入」，輸入團主密碼後可設截止備註、關閉點餐、刪除單人或清空全部。

## 換店家

更新 `menu.json`（格式同現有檔案）。可把新菜單照片交給 Claude 辨識產生。

## 資安說明

- repo 公開，程式中沒有任何密碼或金鑰；團主密碼存在 Apps Script 的指令碼屬性。
- 每位同事的瀏覽器會產生一組隨機憑證，只有本人能修改自己的訂單。
- 拿到網址的人都能送出訂單；訂單內容只有姓名與飲料。
- 寫入試算表的文字會防止公式注入。
