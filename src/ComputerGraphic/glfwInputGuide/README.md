---
title: GLFW Input guide
date: 2025-03-16
tag: computer-graphic
category: computer-graphic
---

# GLFW Input guide

原文連結：[GLFW Input guide](https://www.glfw.org/docs/3.3/input_guide.html)

本文介紹了 GLFW 的輸入相關函數，如果想了解某個類別中特定函數的詳細資訊，請參閱 [Input reference](https://www.glfw.org/docs/3.3/group__input.html)

GLFW 的其他項目也有介紹文：

- [Introduction to the API](https://www.glfw.org/docs/3.3/intro_guide.html)
- [Window guide](https://www.glfw.org/docs/3.3/window_guide.html)
- [Context guide](https://www.glfw.org/docs/3.3/context_guide.html)
- [Vulkan guide](https://www.glfw.org/docs/3.3/vulkan_guide.html)
- [Monitor guide](https://www.glfw.org/docs/3.3/monitor_guide.html)

GLFW 提供多種輸入方式。 不過有些事件(event) 只能輪詢(polling)，例如時間； 也有只能通過回調(callbacks) 的，例如滑鼠滾輪滾動。 但許多事件會同時提供回調和輪詢的方法，回調用起來比輪詢更麻煩，但對 CPU 的需求較低，而且保證不會錯過狀態變化

所有輸入回調都會接收一個視窗句柄(handle)。 通過使用 [window user pointer](https://www.glfw.org/docs/3.3/window_guide.html#window_userptr)，你可以從回調中訪問 non-global 的結構或物件

要更好地了解各種事件回調的行為，可以試著運行 `events` test program。 它註冊了所有 GLFW 支持的回調，並打印出每個事件提供的所有參數，以及時間和序列信息

## Event processing 事件處理

GLFW 需要向視窗系統(window system) 輪詢事件，以便為應用程式提供輸入，同時向視窗系統證明該應用程式沒有鎖死。 事件處理通常發生在每幀的 [buffer swapping](https://www.glfw.org/docs/3.3/window_guide.html#buffer_swap) 之後。 就算沒有視窗，仍然需要進行事件輪詢，以接受顯示器和 joystick 的連接事件

`glfwPollEvents` 用來處理那些已經接收到的事件，它會立即返回，這是在持續渲染(rendering) 時的最佳選項，就像大多數遊戲一樣

如果只需要在接收到新輸入時更新視窗的內容，那 `glfwWaitEvents` 會是更好的選擇，它會讓 thread 進入睡眠的狀態，直到至少接收到一個事件，然後開始處理所有接收到的事件。 這可以節省大量的 CPU 週期，對於編輯工具之類的非常有用

如果要等待某個事件，但有需要定期更新的 UI 元素或其他任務時，可以使用 `glfwWaitEventsTimeout`，它可以讓你指定一個 timeout。 `glfwWaitEventsTimeout` 會使 thread 進入睡眠狀態，直到至少接收到一個事件，或直到指定的秒數過去，然後開始處理任何接收到的事件

如果 main thread 在 `glfwWaitEvents` 中處於睡眠狀態，你可以利用 `glfwPostEmptyEvent` 向 event queue 發一個空事件來從另一個 thread 叫醒它

基本上你會需要用上述的一種或多種方式來處理事件，但回調函式不會只在響應上述的函式時才被調用。 視窗系統可以要求 GLFW 註冊自己的回調函式，這些回調函式可能會在多種視窗系統的函式調用後觸發事件，當這些事件發生時，GLFW 會先處理它們，然後在返回給應用程式之前，把這些事件傳遞給應用程式的回調函式

舉例來說，在 Windows 上，`glfwSetWindowSize` 所使用的系統函數，會直接將視窗大小變更事件發送到每個視窗都有的事件回調函數，而這個回調函數是 GLFW 為其視窗實作的。 

> `glfwSetWindowSize` 這個函數在 Windows 內部是透過 Windows API 來調整視窗大小的，例如 `SetWindowPos` 或 `MoveWindow`<br><br>
> 而 Windows 系統本身會自動產生視窗大小變更的事件，然後把這個事件發送給視窗的事件處理函數（callback），換句話說視窗大小變更事件是由系統自動觸發的，GLFW 只是負責處理這些事件<br><br>
> 每個視窗在 Windows 中都有一個事件回調函數（例如 `WndProc`），GLFW 會幫我們實作這個函數來處理視窗事件

如果你有設定視窗大小回調函數（window size callback），那麼 GLFW 會在 `glfwSetWindowSize` 返回之前，先用新的視窗大小來調用你的回調函數

這表示 `glfwSetWindowSize` 不是單純地改變視窗大小，還會同步觸發事件，使你的回調函數立即收到新的大小資訊。 換句話說，你不需要等到 `glfwPollEvents()` 來觸發這個事件，因為它已經在 `glfwSetWindowSize` 執行期間發生了

這代表你的回調函數可能在意想不到的時機被調用（例如在 `glfwSetWindowSize` 內部），所以在編寫回調函數時，應該考慮到這一點，避免 race condition 或未準備好的狀況

看個例子：

```cpp
void key_callback(GLFWwindow* window, int key, int scancode, int action, int mods) {
    std::cout << "Key event: " << key << std::endl;
}

int main() {
    glfwInit();
    GLFWwindow* window = glfwCreateWindow(800, 600, "Example", nullptr, nullptr);
    glfwSetKeyCallback(window, key_callback);

    while (!glfwWindowShouldClose(window)) {
        glfwSwapBuffers(window); // 交換緩衝區
        glfwPollEvents();        // 處理事件
    }

    glfwDestroyWindow(window);
    glfwTerminate();
}
```

在某些視窗系統中，你可能會發現在 `glfwSwapBuffers(window);` 之後，`key_callback` 也被調用了，即使你還沒有調用 `glfwPollEvents()`

這就是因為：

- `glfwSwapBuffers()` 在某些系統上可能會導致視窗系統處理佇列中的事件，並將它們傳遞給 GLFW
- GLFW 會先調用用戶的回調函數（key_callback）來處理這些事件，然後才從 glfwSwapBuffers 返回

## Keyboard input

GLFW 將鍵盤輸入分為兩種類別：鍵事件（key events）和字符事件（character events）

- 鍵事件（Key Events）：處理的是「按鍵是否被按下/釋放」，對應到物理鍵盤上的按鍵（如 `A`、`Enter`）
- 字符事件（Character Events）：處理的是「鍵盤按下後產生的輸入內容」，與作業系統的輸入法和鍵盤布局 有關（如 `Shift + A` 可能會產生 `A`，而某些鍵盤配置可能會產生 `Ä`）

按鍵與字符之間並不是一對一（1:1）對應的。 一個按鍵可能會產生多個字符，而一個字符也可能需要多個按鍵才能輸入，同時不同使用者之間的鍵盤設定也可能不一樣

### Key Input

如果你希望在按下、釋放實體按鍵或按鍵重複時收到通知，可以設置一個按鍵回調函數

```cpp
glfwSetKeyCallback(window, key_callback);
```

這會將一個視窗與自定義的回調函數 `key_callback` 綁定。 當鍵盤事件發生時，GLFW 會調用這個回調函數，並傳遞四個參數：

- 鍵盤按鍵（key）：對應 GLFW 定義的鍵值，例如 `GLFW_KEY_A`
- 平台相關的掃描碼（scancode）：由作業系統定義的鍵盤掃描碼，與物理鍵盤佈局有關，用來唯一識別按鍵
- 鍵盤行為（action）：表示鍵盤事件的類型，例如按下 (`GLFW_PRESS`)、釋放 (`GLFW_RELEASE`)、重複 (`GLFW_REPEAT`)
- 修飾鍵（mods）：表示是否有 `Shift`、`Ctrl`、`Alt` 等輔助按鍵被按下

舉個例子：

```cpp
void key_callback(GLFWwindow* window, int key, int scancode, int action, int mods)
{
    if (key == GLFW_KEY_E && action == GLFW_PRESS)
        activate_airship();
}
```

這是一個鍵盤回調函數的範例，它在 `E` 鍵被按下(`GLFW_PRESS`) 時執行 `activate_airship()`，`action` 的值可能是 `GLFW_PRESS`、`GLFW_REPEAT` 或 `GLFW_RELEASE`。 當按下一個鍵時，GLFW 會產生 `GLFW_PRESS` 和 `GLFW_RELEASE` 事件。 大多數按鍵在長按時也會產生 `GLFW_REPEAT` 事件

按鍵值（key）會是 GLFW 已定義的 ket token 之一，如果 GLFW 無法識別該鍵（例如 E-mail 鍵或 Play 鍵），則會回傳 `GLFW_KEY_UNKNOWN`

許多鍵盤對於同時按下的按鍵數量有檢測限制，這個限制被稱為「按鍵翻轉」（key rollover）。 一些舊鍵盤可能只能偵測 2~3 個鍵 (`2-key rollover`)，而較好的機械鍵盤可能支援 N-key rollover（可以偵測所有按鍵）

帶有 `GLFW_REPEAT` 動作的鍵盤事件通常用於文字輸入。 它們的觸發頻率取決於使用者的鍵盤設定。 即使同時按住多個鍵，也只會有一個鍵被重複觸發。 因此你不應該用 `GLFW_REPEAT` 事件來判斷哪些按鍵被按住，或用來驅動動畫

相反，你應該根據 `GLFW_PRESS` 和 `GLFW_RELEASE` 動作保存相關按鍵的狀態，或者調用 `glfwGetKey` 函數，它提供了基本的緩存按鍵狀態

例如：

1. 用變數紀錄按鍵狀態：
    ```cpp
    bool keyHeld = false;
    void key_callback(GLFWwindow* window, int key, int scancode, int action, int mods) {
        if (key == GLFW_KEY_W) {
            if (action == GLFW_PRESS) keyHeld = true;
            if (action == GLFW_RELEASE) keyHeld = false;
        }
    }
    ```
2. 使用 `glfwGetKey(window, key)`：
    ```cpp
    if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS) {
        moveCharacterForward();
    }
    ```

無論目標按鍵是否有對應的 GLFW key token，掃描碼（scancode）都是唯一的。 掃描碼是平台特定的（不同系統可能不同），但在同一平台上它是穩定不變的，因此即使不同平台上的按鍵會有不同的掃描碼，但你仍可以將其存起來

你可以使用 `glfwGetKeyScancode` 查詢當前平台支援的任何按鍵標記的掃描碼，下面是個簡單的例子：

```cpp
const int scancode = glfwGetKeyScancode(GLFW_KEY_X);
set_key_mapping(scancode, swap_weapons);
```

每個帶有 key token 的物理按鍵，其最近一次的狀態都會被存儲在每個視窗的狀態陣列中。 
你可以透過 `glfwGetKey` 來查詢，其回傳值只會是 `GLFW_PRESS`（按鍵被按下）或 `GLFW_RELEASE`（按鍵被釋放）：

```cpp
int state = glfwGetKey(window, GLFW_KEY_E);
if (state == GLFW_PRESS)
{
    activate_airship();
}
```

這段程式碼查詢 `E` 鍵的狀態，如果它處於 `GLFW_PRESS` 的狀態，則執行 `activate_airship()`

`glfwGetKey` 並非直接與硬體通信，而是返回 GLFW 內部記錄的最新狀態，因此它可能不是「即時」的資訊，如果你需要即時回應按鍵輸入，那應該去使用回調函式 `glfwSetKeyCallback`。 另外不像回調函數中的 `GLFW_REPEAT`，`glfwGetKey` 無法告訴你按鍵是否正在重複觸發，只能告訴你按下或釋放

每當你查詢鍵盤狀態（poll state）時，你都可能會錯過你想要的狀態變化。 例如，如果某個鍵在你查詢之前已經被按下又釋放，那你會完全錯過這個按鍵事件。 建議的解決方案是使用 key callback，但你也可以用相黏鍵模式 (`GLFW_STICKY_KEYS`)：

```cpp
glfwSetInputMode(window, GLFW_STICKY_KEYS, GLFW_TRUE);
```

當啟用相黏鍵模式時，按鍵的可查詢狀態將保持為 `GLFW_PRESS`，直到使用 `glfwGetKey` 查詢該按鍵的狀態。 一旦查詢過後，如果在此期間處理了按鍵釋放事件，狀態將重置為 `GLFW_RELEASE`，否則保持 `GLFW_PRESS`

如果你想知道輸入事件發生時 Caps Lock 和 Num Lock 鍵的狀態，可以設置 `GLFW_LOCK_KEY_MODS` 輸入模式：

```cpp
glfwSetInputMode(window, GLFW_LOCK_KEY_MODS, GLFW_TRUE);
```

當此輸入模式啟用時，任何收到修飾鍵位（modifier bits）的回調函數，都會在 Caps Lock 開啟時設置 `GLFW_MOD_CAPS_LOCK` 位元，及在 Num Lock 開啟時設置 `GLFW_MOD_NUM_LOCK` 位元

下面是一個在鍵盤回調函數中檢查 Caps Lock / Num Lock 狀態的範例：

```cpp
void key_callback(GLFWwindow* window, int key, int scancode, int action, int mods)
{
    if (mods & GLFW_MOD_CAPS_LOCK)
        std::cout << "Caps Lock is ON!" << std::endl;
    
    if (mods & GLFW_MOD_NUM_LOCK)
        std::cout << "Num Lock is ON!" << std::endl;

    if (key == GLFW_KEY_E && action == GLFW_PRESS)
        activate_airship();
}

int main()
{
    glfwSetInputMode(window, GLFW_LOCK_KEY_MODS, GLFW_TRUE); // 啟用 Caps Lock / Num Lock 偵測
    glfwSetKeyCallback(window, key_callback); // 設定鍵盤回調函數
}
```

`mods & GLFW_MOD_CAPS_LOCK` 用來檢查 `mods` 變數是否包含 `GLFW_MOD_CAPS_LOCK`，表示 Caps Lock 當時是開啟的， `mods & GLFW_MOD_NUM_LOCK` 同理用來檢查 Num Lock 狀態

`GLFW_KEY_LAST` 常數定義了 GLFW 所有已知按鍵的最大值，用來表示 GLFW 支援的最大 key token 範圍，可以用來遍歷所有可能的鍵盤按鍵：

```cpp
for (int key = GLFW_KEY_SPACE; key <= GLFW_KEY_LAST; key++)
{
    if (glfwGetKey(window, key) == GLFW_PRESS)
    {
        std::cout << "Key " << key << " is pressed." << std::endl;
    }
}
```

### Text input

GLFW 支援文字輸入（text input），它的形式是一串 Unicode 碼點（code points），由作業系統的文字輸入系統產生

與按鍵輸入（key input） 不同，文字輸入會受到 keyboard layout 和修飾鍵（modifier keys） 的影響，並支援使用死鍵（dead keys）來組合字符

當接收到 Unicode 碼點後，你可以將其編碼為 UTF-8 或任何其他你偏好的編碼格式

> Unicode 是一種統一的字符編碼標準，每個字符對應一個數值，稱為碼點（code point），例如：
>   - A → U+0041
>   - € → U+20AC
>   - 你 → U+4F60
>
> GLFW 提供的是 Unicode 碼點（UTF-32），但大多數應用程式（如 GUI、網頁）都使用 UTF-8，所以通常需要轉換

由於在 GLFW 支援的所有平台上，`unsigned int` 都是 32 bits 的，你可以將回調函數的碼點參數（code point argument）當作原生端序（native endian）的 UTF-32 來處理

如果你想要提供一般的文字輸入功能，可以設定字符回調函數（character callback）：

```cpp
glfwSetCharCallback(window, character_callback);
```

回調函數會接收對應於正常文字輸入的鍵盤事件所產生的 Unicode 碼點，並且行為類似於該平台上的標準文字輸入框。 這表示 `glfwSetCharCallback` 只會處理導致文字輸入的按鍵，例如按 `A`、`1`、`@` 這些鍵時，它會給你對應的 Unicode 碼點。 但如果按 `Ctrl`、`Shift` 這類不會產生文字輸入的鍵，則回調函數不會被調用

下面是一個字符輸入的回調函數的例子，當 GLFW 接收到文字輸入時，會呼叫這個函數並傳入 Unicode 碼點：

```cpp
void character_callback(GLFWwindow* window, unsigned int codepoint) {}
```

`codepoint` 是一個 Unicode 碼點（UTF-32），代表使用者輸入的文字。 你可以將 `codepoint` 轉換為 UTF-8 並顯示：

```cpp
void character_callback(GLFWwindow* window, unsigned int codepoint)
{
    std::cout << "Unicode character input: " << codepoint << std::endl;
}
```

當輸入特殊字符（如 `é`, `你`）時，這個函數會正確處理，與鍵盤佈局無關

### Key names

如果你希望透過名稱來引用按鍵，可以使用 `glfwGetKeyName` 來查詢可顯示按鍵（printable keys） 在當前鍵盤佈局下的名稱：

```cpp
const char* key_name = glfwGetKeyName(GLFW_KEY_W, 0);
show_tutorial_hint("Press %s to move forward", key_name);
```

這個函數可以處理按鍵和掃描碼。 如果提供的按鍵是 `GLFW_KEY_UNKNOWN`，則會使用掃描碼；否則掃描碼將被忽略。 這個行為與 key callback 的行為一致，因此你可以直接將回調函數的參數傳入 `glfwGetKeyName`，無需修改：

```cpp
void key_callback(GLFWwindow* window, int key, int scancode, int action, int mods)
{
    const char* key_name = glfwGetKeyName(key, scancode);
    std::cout << "Key pressed: " << (key_name ? key_name : "Unknown") << std::endl;
}
```

