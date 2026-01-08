

## Direct Rendering Infrastructure

Direct Rendering Infrastructure（DRI，直接算繪基礎架構）是構成現代 Linux 圖形 stack 的框架，讓沒有特權的 user space 程式在不與其他程式產生衝突的情況下，能夠對圖形硬體下達命令。 DRI 的主要用途，是為 `Mesa` 的 `OpenGL` 實作提供硬體加速。 DRI 也曾被改造，用來在沒有執行顯示伺服器的 framebuffer console 上提供 `OpenGL` 加速

DRI 的實作分散在 X Server 以及其相關的 client 函式庫、`Mesa 3D`，還有 `Direct Rendering Manager` 核心子系統之中。 它的所有原始碼都是開放原始碼軟體

### 概觀

在傳統 X Window System 的架構裡，X Server 是唯一擁有對圖形硬體獨佔存取權的行程，因此也就是那個在 framebuffer 上做實際算繪的行程。 所有 X client 能做的事，就是和 X Server 溝通，並把算繪命令交給它

這些命令與硬體無關，也就是說 X11 協定提供了一個 API 來抽象圖形裝置，讓 X client 不需要知道或擔心底層硬體的細節。 任何與硬體相關的程式碼都放在 Device Dependent X 之中，也就是 X Server 中負責管理各種顯示卡或圖形介面卡的部分，這一部分通常也被稱為顯示或圖形驅動程式

3D 算繪的興起顯露出這套架構的限制。 3D 圖形應用程式往往會產生大量命令與資料，所有這些都必須送交 X Server 來算繪。 隨著 X client 與 X Server 之間的跨行程通訊（IPC）量愈來愈大，3D 算繪效能就會遭到影響，影響的程度甚至讓 X 驅動程式開發者認為，如果要充分善用最新顯示卡的 3D 硬體能力，就必須改用一種不再依賴 IPC 的新架構

X client 應該能直接存取圖形硬體，而不是仰賴另一個行程代為存取，藉此節省所有 IPC 的額外負擔。 這種做法稱為「direct rendering」，與傳統 X 架構所提供的「indirect rendering」相對。 Direct Rendering Infrastructure 一開始的開發目標，就是讓任何 X client 都能用這種 direct rendering 的方式來進行 3D 算繪

DRI 本身並沒有任何機制阻止人們用它來在 X client 內實作具加速功能的 2D direct rendering。 只是沒有人有這樣的需求，因為 2D indirect rendering 的效能已經夠好。 [by whom?]

### 軟體架構

Direct Rendering Infrastructure 的基本架構包含三個主要元件：

- DRI client（例如執行 direct rendering 的 X client）需要一個與硬體相關的「驅動程式」，來管理目前的顯示卡或圖形介面卡，才能在其上進行算繪。 這些 DRI 驅動程式通常以 shared library 的形式提供，client 會在執行時動態連結到這些函式庫
  
  由於 DRI 是為了充分利用 3D 圖形硬體而設計，這些函式庫在 client 看來，通常就是某個以硬體加速的 3D API 實作，例如 `OpenGL`，而這套實作可能由 3D 硬體廠商本身提供，也可能是像 `Mesa 3D` 這類自由軟體專案提供的第三方實作
- X Server 提供一個 X11 協定擴充，也就是 DRI extension，DRI client 會透過它與視窗系統及 DDX 驅動程式協調運作。 作為 DDX 驅動程式的一部分，X Server 行程本身也很常會動態連結到與 DRI client 相同的 DRI 驅動程式，不過用途是透過 GLX extension，為那些使用 indirect rendering 的 X client（例如無法使用 direct rendering 的遠端 X client）提供硬體加速的 3D 算繪。 對於 2D 算繪，DDX 驅動程式也必須考慮那些使用相同圖形裝置的 DRI client
- 對顯示卡或圖形介面卡的存取則是由一個名為 `Direct Rendering Manager`（DRM）的核心元件負責管理。 X Server 的 DDX 驅動程式以及每一個 X client 的 DRI 驅動程式都必須透過 DRM 來存取圖形硬體
  
  DRM 為圖形硬體的共享資源提供同步機制，例如 command queue、卡上的暫存器、視訊記憶體、DMA 引擎等，確保所有這些相互競爭的 user space 行程在同時存取時不會互相干擾。 DRM 同時也扮演基本的安全控管角色，不允許任何 X client 在進行 3D 算繪所需範圍之外直接存取硬體

### DRI1

在原始的 DRI 架構中，由於當時顯示卡的記憶體容量有限，畫面 front buffer 與 back buffer 只有一份實體，所有 DRI client 與 X Server 都共用同一組緩衝區（還有額外的 depth buffer 與 stencil buffer）。 它們全部都直接對 back buffer 做算繪，然後在垂直消隱期（vertical blanking interval）將 back buffer 與 front buffer 做交換。 為了能對 back buffer 做算繪，DRI 行程必須確保它的算繪結果會被裁剪在自己視窗所保留的區域之內

與 X Server 的同步是透過訊號以及一塊名為 SAREA 的 shared memory 緩衝區來完成。 對 DRM 裝置的存取是獨佔的，也就是說，任何 DRI client 在開始一段算繪操作時，都必須先取得對裝置的 lock

在這段期間，其他使用該裝置的程式（包含 X Server）都會被阻擋，只能等到目前這個算繪操作結束並釋放 lock 後才能繼續，即便兩邊的操作之間其實不會發生任何衝突也一樣。 另一個缺點是，當目前的 DRI 行程釋放對裝置的 lock 之後，各種作業不會保留記憶體配置狀態，因此任何已經上傳到圖形記憶體中的資料（例如貼圖）都會在之後的操作中消失，對圖形效能造成顯著影響

目前 DRI1 被視為完全過時，不應再被使用

### DRI2

隨著像 Compiz 這類 compositing window manager 的普及，Direct Rendering Infrastructure 必須重新設計，讓 X client 在使用 direct rendering 時也能支援被重新導向到「offscreen pixmap」。 一般的 X client 會服從 X Server 所提供的 render target 重新導向，也就是所謂的 offscreen pixmap，並以這個 pixmap 作為繪圖目標

但是 DRI client 仍然直接算繪到共用的 backbuffer 上，實際上繞過了 compositing window manager。 最終的解決方案，是改變 DRI 處理 render buffer 的方式，這導致一個完全不同的 DRI extension（帶有一組新的操作），以及 Direct Rendering Manager 內部的大幅修改

這個新的 extension 名為「DRI2」，但它不是原本 DRI 的單純新版，而是一個與原始 DRI 甚至不相容的不同 extension，事實上兩者在 X Server 內還共存了相當長的一段時間

在 DRI2 中，不再使用單一共用的（back）buffer，而是讓每個 DRI client 都擁有自己的私有 back buffer，同時還有對應的 depth buffer 與 stencil buffer，用來透過硬體加速為自己的視窗內容做算繪。 之後 DRI client 會把這個 back buffer 與一個假的「front buffer」做交換，compositing window manager 則會把這個 fake front buffer 當作來源之一，與其他來源一起組合出最終的畫面 back buffer，並在垂直消隱期時與真正的 front buffer 做交換

為了處理所有這些新的緩衝區，Direct Rendering Manager 必須加入新的功能，特別是一個圖形記憶體管理器。 DRI2 一開始是以實驗性的 TTM 記憶體管理器開發，但在 `GEM` 被選為正式的 DRM 記憶體管理器之後，DRI2 又被改寫成使用 GEM。 新的 DRI2 內部緩衝區管理模型同時也解決了原始 DRI 實作中的兩個主要效能瓶頸：

- DRI2 client 在進行算繪時不再會 lock 住整個 DRM 裝置，因為現在每個 client 都有獨立的 render buffer，與其他行程彼此獨立
- DRI2 client 可以在視訊記憶體中自行配置、保留自己的緩衝區（用來存放貼圖、頂點列表等），而且可以按照自己需求保留任意久，這大幅降低了視訊記憶體頻寬的消耗

在 DRI2 中，視窗所需的私有 offscreen 緩衝區（back buffer、fake front buffer、depth buffer、stencil buffer 等）的配置，是由 X Server 本身負責的。 DRI client 會透過 DRI2 extension 中的操作，例如 `DRI2GetBuffers` 與 `DRI2GetBuffersWithFormat`，來取得這些緩衝區，並在其上為視窗進行算繪

在內部，DRI2 使用 GEM names，也就是 GEM API 所提供的一種 global handle，讓兩個存取同一個 DRM 裝置的行程可以用相同的名稱指到同一個 buffer，用這種方式在 X11 協定中傳遞這些緩衝區的「參照」。 會由 X Server 負責分配視窗 render buffer 的理由，是因為 GLX extension 允許多個 X client 在同一個視窗中協同進行 `OpenGL` 算繪

這樣一來，X Server 就能在整個算繪流程中管理 render buffer 的完整生命週期，並且知道什麼時候可以安全地回收或丟棄它們。 當視窗大小被調整時，X Server 也負責配置符合新視窗大小的 render buffer，並透過 `InvalidateBuffers` 事件通知那些對該視窗進行算繪的 DRI client，讓它們重新取得新緩衝區的 GEM name

DRI2 extension 還提供了其他對 DRI client 而言的核心操作，例如用來查出應該使用哪一個 DRM 裝置與驅動程式的 `DRI2Connect`，或是讓 DRI client 通過 X Server 認證，才能使用 DRM 裝置提供的算繪與緩衝區功能的 `DRI2Authenticate`。 將算繪完成的緩衝區送上螢幕，則是透過 `DRI2CopyRegion` 與 `DRI2SwapBuffers` 這兩個請求來完成

`DRI2CopyRegion` 可以用來在 fake front buffer 與真正的 front buffer 之間進行資料複製，但它不會提供與垂直消隱期的同步，因此可能會造成畫面撕裂。 相較之下，`DRI2SwapBuffers` 則會在支援的情況下，對大小相同的 back buffer 與 front buffer 做 VBLANK 同步的交換，在尺寸不同時則退而求其次改成做複製（blit）

### DRI3

雖然 DRI2 相對原始的 DRI 已經是顯著的改進，但這個新 extension 也引入了某些新的問題。 2013 年，Direct Rendering Infrastructure 的第三次演化，也就是 DRI3，被開發出來以解決這些問題

DRI3 與 DRI2 的主要差異如下：

- DRI3 client 會自行配置自己的 render buffer，而不是像 DRI2 那樣仰賴 X Server 幫忙配置
- DRI3 不再使用舊有那套以 GEM name（global GEM handle）為基礎、用來在 DRI client 與 X Server 之間傳遞 buffer 物件的、不安全的 GEM buffer 分享機制，而是改用更安全、也更通用的 PRIME DMA-BUF 機制，這是一種以 file descriptor 為基礎的方式

在 client 端進行緩衝區配置會打破 GLX 的某些假設，也就是不再可能讓多個 GLX 應用程式協同在同一個視窗中進行算繪。 但反過來看，由於 DRI client 在整個生命週期中都能完全掌控自己的緩衝區，因此也帶來許多好處。 例如，DRI3 client 可以很輕易地確保 render buffer 的大小永遠與視窗目前大小保持一致，從而消除 DRI2 時代因為 client 與 server 之間 buffer 尺寸同步不足而導致視窗調整大小時產生的各種畫面瑕疵

由於 DRI3 client 不再需要多等一次 X Server 回傳 render buffer 的往返時間，也能取得更好的效能。 DRI3 client，尤其是 compositing window manager，還可以利用保存前幾幀的舊緩衝區，只針對視窗中受損的區域進行增量算繪，作為另一項效能最佳化手段

DRI3 extension 也不再需要因應新的特殊緩衝區格式而修改，因為這些格式現在直接由 DRI client 驅動程式與 DRM 核心驅動程式之間處理。 另一方面，使用 file descriptor 也讓核心可以安全地清除任何不再使用的 GEM buffer 物件，也就是那些已經完全沒有任何參照的物件

在技術上，DRI3 由兩個不同的 extension 組成，分別是「DRI3」extension 與「Present」extension。 DRI3 extension 的主要目的，是實作在 DRI client 與 X Server 之間共享 direct rendering 緩衝區的機制。 DRI client 會配置並使用 GEM buffer 物件作為算繪目標，而 X Server 則會以一種稱為「pixmap」的 X11 物件型別來表示這些 render buffer

DRI3 提供 `DRI3PixmapFromBuffer` 與 `DRI3BufferFromPixmap` 兩個操作，分別用來從一個 GEM buffer 物件（位於「DRI client 空間」）建立一個 pixmap（位於「X Server 空間」），以及反向從一個 X pixmap 取得對應的 GEM buffer 物件。 在這些 DRI3 操作中，GEM buffer 物件是以 DMA-BUF file descriptor 的形式傳遞，而不是使用 GEM name

DRI3 也提供一種方式，讓 DRI client 與 X Server 可以共享同步物件，藉此對共享緩衝區進行序列化存取。 與 DRI2 不同的是，DRI3 開始時的 `DRI3Open` 操作，也就是每個 DRI client 一開始必須呼叫、用來取得應該使用哪一個 DRM 裝置的那個操作，回傳的是一個已經打開的裝置節點 file descriptor，而不是裝置節點的檔名字串，所需的認證程序則由 X Server 事先代為完成

DRI3 本身沒有任何將算繪完成的緩衝區顯示在螢幕上的機制，而是改為仰賴另一個 extension，也就是 Present extension，來完成這個工作。 Present 之所以得名，是因為它的主要任務就是在螢幕上「呈現」緩衝區，也就是負責使用 client 應用程式提供的 render buffer 內容來更新 framebuffer

螢幕更新必須在適當的時機進行，通常要在垂直消隱期期間，才能避免撕裂這類顯示瑕疵。 Present 也負責將螢幕更新與垂直消隱期同步。 它還會透過事件讓 X client 知道每一個緩衝區實際出現在螢幕上的時間點，讓 client 可以把自己的算繪流程與目前的螢幕更新頻率同步

Present 可以接受任何 X pixmap 作為螢幕更新的來源。 由於 pixmap 是標準的 X 物件，Present 不僅能被執行 direct rendering 的 DRI3 client 使用，也能被任何以 pixmap 作為算繪目標的 X client 使用，無論其算繪方式為何。 例如，多數既有、非 GL 為基礎的 GTK+ 與 Qt 應用程式，過去都是透過 `XRender` 使用 double buffered pixmap 算繪

這些應用程式同樣可以使用 Present extension 來達成高效且不會撕裂的螢幕更新。 這也是為什麼 Present 會被設計成獨立於 DRI3 之外的 extension，而不是被視為 DRI3 的一部分

除了讓非 GL 的 X client 能與垂直消隱期同步之外，Present 還帶來其他好處。 DRI3 的圖形效能更好，因為 Present 在 buffer 交換上的效率優於 DRI2。 此外，許多 DRI2 時代無法支援的 `OpenGL` extension，現在也能基於 Present 提供的新功能而獲得支援

Present 向 X client 提供兩個主要操作：一個是使用 pixmap 的部分或全部內容，來更新視窗中的某個區域（`PresentPixmap`），另一個則是設定與某個視窗相關的呈現事件型別，也就是 client 希望被通知的事件種類（`PresentSelectInput`）

視窗可以就三種呈現事件通知 X client：一是當一個進行中的呈現操作（通常源自 `PresentPixmap` 的呼叫）完成時（`PresentCompleteNotify`），二是當一個在 `PresentPixmap` 操作中使用的 pixmap 已經可以被重新使用時（`PresentIdleNotify`），三是當視窗的組態發生變化時，主要是視窗大小改變（`PresentConfigureNotify`）

在一個 `PresentPixmap` 操作中，究竟是直接對 front buffer 做複製（blit），還是將整個 back buffer 與 front buffer 做交換，屬於 Present extension 實作的內部細節，而不再像 DRI2 那樣由 X client 明確選擇

### 採用情況

已經被撰寫出來的多種開放原始碼 DRI 驅動程式，包含用於 ATI Mach64、ATI Rage128、ATI Radeon、3dfx Voodoo3 至 Voodoo5、Matrox G200 至 G400、SiS 300 系列、Intel i810 至 i965、S3 Savage、VIA UniChrome 圖形晶片組，以及用於 Nvidia 的 `nouveau`。 也有一些圖形廠商撰寫了封閉原始碼的 DRI 驅動程式，例如 ATI 與 PowerVR Kyro

各種版本的 DRI 也已在多種作業系統上實作，其中包括 Linux 核心、FreeBSD、NetBSD、OpenBSD 與 OpenSolaris

### 歷史

這個專案最初是由 Precision Insight 的 Jens Owen 與 Kevin E. Martin 啟動，資金來源為 Silicon Graphics 與 Red Hat。 它第一次被廣泛使用，是作為 XFree86 4.0 的一部分，而如今則已成為 X.Org Server 的一部分。 目前由自由軟體社群負責維護

關於 DRI2 的開發工作，是從 2007 年 X Developers' Summit 上 Kristian Høgsberg 提出的一項提案開始。 Høgsberg 本人撰寫了新的 DRI2 extension，以及對 `Mesa` 與 GLX 的修改。 2008 年 3 月時，DRI2 已大致完成，但無法趕上 X.Org Server 1.5 版，只好等到 2009 年 2 月釋出的 1.6 版才正式納入

DRI2 extension 正式包含在 2009 年 10 月發行的 X11R7.5 版本中。 DRI2 協定的第一個公開版本（2.0）於 2009 年 4 月宣布。 從那之後又有數次修訂，最近的一版是 2012 年 7 月的 2.8 版

由於 DRI2 的多項限制，一個名為 DRI-Next 的新 extension 在 2012 年 X.Org Developer's Conference 上由 Keith Packard 與 Emma Anholt 提出。 該 extension 在 2013 年 Linux.conf.au 上又以 DRI3000 的名稱再度被提出

DRI3 與 Present 這兩個 extension 於 2013 年間被開發完成，並在 2013 年 12 月釋出的 X.Org Server 1.15 版本中合併進主分支。 DRI3 協定的第一個也是唯一一個版本（1.0）則是在 2013 年 11 月釋出

## Direct Rendering Manager

Direct Rendering Manager（DRM）是 Linux 作業系統核心中的一個子系統，負責與現代顯示卡上的 GPU 進行介接。 DRM 對外提供一組 API，讓 user space 的程式可以把命令與資料送到 GPU，並執行各種操作，例如設定顯示器的模式（mode setting）

DRM 一開始是作為 X Server Direct Rendering Infrastructure 的 kernel space 元件而被開發出來，但之後也被其他圖形 stack 的替代方案（例如 Wayland）以及各種獨立應用程式與函式庫（例如 `SDL2` 與 `Kodi`）採用

user space 的程式可以透過 DRM API 控制 GPU 進行硬體加速的 3D 算繪與影片解碼，也可以做 GPGPU 計算

### 概觀

Linux 作業系統核心原本就有一個名為 `fbdev` 的 API，用來管理顯示卡的 framebuffer，但它無法滿足現代以 GPU 為基礎、支援 3D 加速的視訊硬體需求。 這些裝置通常需要在自己的記憶體中設定與管理一個命令佇列，用來把命令派送給 GPU，同時也必須管理該記憶體中的緩衝區與可用空間

一開始，user space 的程式（例如 X Server）會直接管理這些資源，但它們通常的作法就像只有自己會存取這些資源一樣。 當兩個以上的程式同時嘗試控制同一套硬體，而且各自用自己的方式去設定這些資源時，多半會以災難性的結果收場

Direct Rendering Manager 的設計目的，就是讓多個程式可以協同使用視訊硬體的資源。 DRM 會獨占存取 GPU，負責初始化與維護命令佇列、記憶體以及其他所有硬體資源。 想要使用 GPU 的程式會把請求送給 DRM，由 DRM 扮演仲裁者的角色，負責避免可能發生的衝突

多年下來，DRM 的範圍也一路擴張，把許多原本由 user space 程式處理的功能都納進來，例如 framebuffer 管理與 mode setting、用來分享記憶體的物件以及記憶體同步等

其中有些擴充功能被賦予了特定名稱，例如 Graphics Execution Manager（`GEM`）或 kernel mode-setting（`KMS`），當特別提到它們所提供的那些功能時，這些術語依然會被單獨拿出來說明。 不過，這些東西其實都只是整個核心 DRM 子系統的一部分

在一台電腦中同時配備兩個 GPU（例如一個獨立 GPU 搭配一個整合式 GPU）的趨勢，帶來了像 GPU 切換這類新問題，而這些問題也必須在 DRM 這一層加以解決。 為了對應 Nvidia Optimus 技術，DRM 被加入了 GPU offloading 的能力，稱為 `PRIME`

### 軟體架構

Direct Rendering Manager 位在 kernel space，因此 user space 的程式必須透過核心的系統呼叫來請求它提供服務。 不過，DRM 本身並沒有定義一組客製化的系統呼叫，而是遵循 Unix 的「一切皆檔案」原則，透過檔案系統的命名空間，在 `/dev` 階層下使用裝置檔案來對外呈現 GPU

每一個被 DRM 偵測到的 GPU 都被視為一個 DRM 裝置，系統會為它建立一個裝置檔案 `/dev/dri/cardX`（其中 X 是遞增的編號）作為與它互動的介面。 想要和 GPU 溝通的 user space 程式必須開啟這個檔案，並透過 `ioctl` 呼叫與 DRM 溝通，不同的 `ioctl` 對應到 DRM API 的不同功能

為了讓 user space 程式比較容易和 DRM 子系統互動，有人寫了一個名為 `libdrm` 的函式庫。 這個函式庫其實只是包了一層 wrapper，為 DRM API 的每一個 `ioctl` 提供一個對應的 C 語言函式，另外也定義了常數、結構以及其他輔助用的元素。 使用 `libdrm` 不只可以避免把核心介面直接暴露給應用程式，還能享有在程式之間重複利用與分享程式碼的常見好處

DRM 由兩個部分組成：一個是通用的「DRM core」，另一個則是針對每一種支援硬體所實作的「DRM driver」。 DRM core 提供了一個基本框架，讓不同的 DRM driver 可以在其中註冊，並且對 user space 提供一組最小的 `ioctl` 集合，實作一些共同的、與硬體無關的功能

相對地，DRM driver 則負責實作這套 API 中和硬體相關的部分，也就是針對它所支援的那種 GPU 所特有的功能。 它不但要提供那些 DRM core 沒有涵蓋到的其餘 `ioctl` 的實作，還可以延伸這套 API，額外提供只有在該硬體上才有的 `ioctl` 與額外功能

當某個特定的 DRM driver 提供了擴充後的 API 時，user space 這一側的 `libdrm` 也會額外加上一個 `libdrm-driver` 函式庫，讓 user space 可以用它來呼叫這些額外的 `ioctl`

### API

DRM core 對 user space 應用程式輸出數個介面，通常預期是透過對應的 `libdrm` wrapper 函式來使用。 此外，各個 driver 也會透過 `ioctl` 與 `sysfs` 檔案輸出與裝置相關的專用介面，供 user space 的驅動程式與了解裝置細節的應用程式使用。 這些對外介面包含：記憶體映射、context 管理、DMA 操作、AGP 管理、vblank 控制、fence 管理、記憶體管理以及輸出管理

### DRM-Master 與 DRM-Auth

在 DRM API 中有幾個 `ioctl` 是出於安全性或並行控制的考量，必須限制成每個裝置只能由單一個 user space 行程使用。 為了實作這項限制，DRM 要求這類 `ioctl` 只能由被視為某個 DRM 裝置「master」的那個行程呼叫，這個行程通常被稱作 DRM-Master

所有開啟了 `/dev/dri/cardX` 這個裝置節點的行程當中，只有一個會被標記為 master，也就是第一個呼叫 `SET_MASTER` `ioctl` 的那個行程。 任何不是 DRM-Master 的行程如果嘗試呼叫這些受限制的 `ioctl`，都會得到錯誤。 某個行程也可以主動放棄它的 master 身分，讓其他行程得以取得這個角色，做法是呼叫 `DROP_MASTER` `ioctl`

在實務上，X Server（或其他顯示 server）通常就是為每個它所管理的 DRM 裝置取得 DRM-Master 身分的那個行程，通常是在啟動時開啟對應的裝置節點時取得，之後會在整個圖形工作階段中持續保有這些權限，直到該行程結束或當掉為止

對於其餘的 user space 行程，還有另一種方式可以取得在 DRM 裝置上呼叫部分受限制操作的權限，稱為 DRM-Auth。 它基本上是一種對 DRM 裝置做身分認證的方法，用來向裝置證明某個行程已經獲得 DRM-Master 核可，可以取得這些權限。 這個流程大致如下：:13

- client 透過 `GET_MAGIC` `ioctl` 從 DRM 裝置取得一個唯一的權杖，也就是一個 32 位元整數，然後用任何方式把它傳給 DRM-Master 行程，通常是某種 IPC 機制，例如在 DRI2 中，任何 X client 都可以送一個 `DRI2Authenticate` 請求給 X Server
- DRM-Master 行程接著呼叫 `AUTH_MAGIC` `ioctl`，把這個權杖送回 DRM 裝置
- 裝置會把那些驗證權杖與 DRM-Master 傳來權杖相符的檔案控制代碼，標記為擁有額外權限

### Graphics Execution Manager

隨著視訊記憶體的容量不斷成長，以及 `OpenGL` 等圖形 API 的複雜度日益提高，在每一次 context switch 時就重新初始化顯示卡狀態，對效能來說變得太過昂貴。 此外，現代的 Linux 桌面環境也需要一個更佳的方式，來和 compositing manager 分享 off-screen 緩衝區。 這些需求促使人們在核心內部開發新的圖形緩衝區管理方法，其中之一就是 Graphics Execution Manager（`GEM`）

`GEM` 提供了一組具有明確記憶體管理原語的 API。 透過 `GEM`，user space 程式可以在 GPU 的視訊記憶體中建立、操作與銷毀記憶體物件。 這些物件被稱為「GEM objects」，從 user space 程式的角度看，它們是持久存在的，不需要在程式每次重新取得 GPU 控制權時又重新載入

當某個 user space 程式需要一塊視訊記憶體（用來存放 framebuffer、texture 或 GPU 所需的其他任何資料）時，它會透過 `GEM` API 向 DRM driver 請求配置。 DRM driver 會追蹤已使用的視訊記憶體狀況，如果還有可用空間，就能滿足這個請求，並回傳一個「handle」給 user space，讓之後的操作可以用這個 handle 來引用那塊配置好的記憶體

`GEM` API 也提供填入緩衝區內容與在不再需要時釋放緩衝區的操作。 對於沒有被釋放的 GEM handle，其對應的記憶體會在 user space 行程關閉 DRM 裝置的檔案描述元時被回收，無論是刻意關閉還是因為行程終止所導致

`GEM` 也允許兩個或更多使用同一個 DRM 裝置（也就是同一個 DRM driver）的 user space 行程，共享同一個 GEM object。 GEM handle 是區域性的 32 位元整數，在每個行程中都是唯一的，但不同行程之間可以重複，所以不適合作為共享識別

所需要的是一個全域命名空間，`GEM` 透過稱為 GEM name 的全域 handle 來提供這個功能。 GEM name 使用一個唯一的 32 位元整數，對應於同一個 DRM 裝置上、由同一個 DRM driver 建立的唯一一個 GEM object。 `GEM` 提供了一個名為 `flink` 的操作，可以從 GEM handle 取得對應的 GEM name。 :16 

行程接著可以透過任意可用的 IPC 機制，把這個 GEM name（那個 32 位元整數）傳給另一個行程。 :15 接收方可以用這個 GEM name 換取一個本地的 GEM handle，指向原本那個 GEM object

不幸的是，使用 GEM name 來分享緩衝區並不安全。 :16 某個惡意的第三方行程只要能存取同一個 DRM 裝置，就可以透過嘗試各種 32 位元整數的方式，去猜測由其他兩個行程共享的某個緩衝區的 GEM name。 一旦猜中這個 GEM name，就能存取甚至修改該緩衝區的內容，破壞其中資訊的機密性與完整性

這個缺點後來透過在 DRM 中加入 `DMA-BUF` 支援而被克服，因為 `DMA-BUF` 在 user space 中是用檔案描述元來代表緩衝區，這種表示方式可以安全地進行分享

對任何視訊記憶體管理系統來說，除了管理視訊記憶體空間本身之外，另一項重要工作是處理 GPU 與 CPU 之間的記憶體同步。 現代的記憶體架構相當複雜，通常在系統記憶體上會有多層快取，有時候在視訊記憶體上也會有快取

因此，視訊記憶體管理程式也必須處理快取一致性，確保 CPU 與 GPU 之間共享的資料是相互一致的。 這也意味著視訊記憶體管理的內部實作往往高度依賴於 GPU 的硬體細節與記憶體架構，因此會非常 driver-specific

`GEM` 一開始是由 Intel 的工程師開發，用來為自家的 `i915` driver 提供一個視訊記憶體管理器。 Intel GMA 9xx 這個系列屬於採用 Uniform Memory Architecture（UMA）的整合式 GPU，也就是 GPU 與 CPU 共用同一塊實體記憶體，而不是另外有一塊專用的 VRAM

`GEM` 透過定義「memory domains」來處理記憶體同步，這些 memory domain 在設計上雖然與 GPU 無關，但它們是以 UMA 記憶體架構為前提來設計的，因此並不那麼適合用在具有獨立 VRAM 的其他記憶體架構上。 出於這個原因，其他一些 DRM driver 選擇對 user space 程式提供 `GEM` API，但在內部則實作一個更適合自身硬體與記憶體架構的不同記憶體管理器

`GEM` API 也提供了用來控制執行流程（command buffer）的數個 `ioctl`，但這些都是針對 Intel 所設計，只打算給 Intel `i915` 以及之後的 GPU 使用。 目前並沒有其他 DRM driver 嘗試實作 `GEM` API 中記憶體管理相關 `ioctl` 以外的部分

### Translation Table Maps

Translation Table Maps（`TTM`）是比 `GEM` 更早出現的一個通用 GPU 記憶體管理器的名稱。 它被特別設計用來管理 GPU 可能會存取的各種不同型態的記憶體，其中包括專用的 Video RAM（通常焊在顯示卡上）以及透過一個稱為 Graphics Address Remapping Table（`GART`）的 I/O 記憶體管理單元所能存取的系統記憶體

`TTM` 也必須處理那些 CPU 無法直接定址的 VRAM 區段，並在考量 user space 圖形應用程式通常會處理大量視訊資料的情況下，以盡可能佳的效能來完成這些工作。 另一項重要的課題是要維持不同記憶體與相關快取之間的一致性

`TTM` 的核心概念是「buffer objects」，也就是那些在某個時間點必須能被 GPU 定址到的視訊記憶體區塊。 當某個 user space 圖形應用程式想要存取某個 buffer object（通常是為了把內容填進去）時，`TTM` 可能需要把它搬移到一種 CPU 可以定址的記憶體型態

當 GPU 需要存取某個 buffer object 而它尚未位於 GPU 的位址空間中時，之後也可能會發生進一步的搬移，或者 `GART` 映射操作。 每一次這類搬移操作都必須處理相關的資料與快取一致性問題

`TTM` 另一個重要的概念是 fences。 fence 本質上是一種用來管理 CPU 與 GPU 之間並行關係的機制。 fence 會追蹤某個 buffer object 何時不再被 GPU 使用，通常會用這個資訊來通知那些可以存取該 buffer object 的 user space 行程

`TTM` 企圖同時以合適的方式管理所有種類的記憶體架構，包括有專用 VRAM 與沒有專用 VRAM 的情況，並且想在記憶體管理器中提供幾乎所有你想得到的功能，讓任何類型的硬體都能使用，結果導致整體解法過於複雜，而且 API 的規模遠大於實際需求

有些 DRM 開發者認為它和任何特定 driver 都不太合拍，尤其是那組 API。 當 `GEM` 以一個較為精簡的記憶體管理器姿態出現時，人們在 API 層面上普遍比較偏好 `GEM` 而不是 `TTM`。 不過，也有一些 driver 的開發者認為 `TTM` 採取的做法比較適合用在具有專用視訊記憶體與 IOMMU 的獨立顯示卡上，所以他們選擇在內部使用 `TTM`，同時把自己的 buffer objects 以 GEM objects 的形式對外輸出，藉此支援 `GEM` API

目前使用 `TTM` 作為內部記憶體管理器、但對外提供 `GEM` API 的 driver 範例，包括用在 AMD 顯示卡上的 `radeon` driver，以及用在 NVIDIA 顯示卡上的 `nouveau` driver

### DMA Buffer Sharing 與 PRIME

DMA Buffer Sharing API（通常縮寫為 `DMA-BUF`）是一個 Linux 作業系統核心內部的 API，設計目的是提供一套通用機制，讓多個裝置之間可以共享 DMA 緩衝區，而這些裝置很可能是由不同類型的裝置驅動程式所管理

例如，一個 Video4Linux 裝置與一個圖形介面卡裝置可以透過 `DMA-BUF` 共享緩衝區，達成影片串流資料從前者產生、後者消費的零拷貝（zero-copy）傳遞。 任何 Linux 裝置驅動程式都可以實作這個 API，扮演 exporter、user（consumer）或兩者兼具的角色

這項能力最早是在 DRM 中被用來實作 `PRIME`，也就是一種 GPU offloading 的解法，它透過 `DMA-BUF` 在獨立 GPU 與整合式 GPU 的 DRM driver 之間共享算出的 framebuffer。 :13 

`DMA-BUF` 一個重要的特性是，共享緩衝區在 user space 會以檔案描述元的形式呈現。 :17 為了開發 `PRIME`，DRM API 新增了兩個 `ioctl`，一個用來把本地的 GEM handle 轉換成 `DMA-BUF` 檔案描述元，另一個則做相反的轉換

這兩個新的 `ioctl` 後來也被重新利用，拿來修補 GEM 緩衝區分享機制本身不安全的問題。 :17 和 GEM name 不同，檔案描述元無法被隨便猜測出來，因為它不是一個全域命名空間，而且 Unix 作業系統提供了一種安全的方式，可以在 Unix domain socket 中透過 `SCM_RIGHTS` 語意來傳遞檔案描述元。 :11 

某個行程如果想把一個 GEM object 分享給另一個行程，可以先把自己的本地 GEM handle 轉換成 `DMA-BUF` 檔案描述元，再把它傳給對方，接收方則可以從收到的檔案描述元當中取得自己的 GEM handle。 :16 這種方法在 `DRI3` 中被用來在 client 與 X Server 之間分享緩衝區，也同樣被 Wayland 採用

### Kernel Mode Setting

為了能正常運作，顯示卡或顯示介面卡必須設定一個 mode，也就是螢幕解析度、色彩深度與重新整理率的組合，而且這組數值必須落在顯示卡本身以及所連接顯示器所支援的範圍之內。 這個操作稱為 mode-setting，而且通常需要直接存取圖形硬體，也就是能夠對顯示卡顯示控制器上的某些暫存器進行寫入。 在開始使用 framebuffer 之前，以及當應用程式或使用者要求變更 mode 時，都必須執行一次 mode-setting 操作

在早期，想要使用圖形 framebuffer 的 user space 程式也同時負責提供 mode-setting 操作。 因此，它們必須以具有對視訊硬體特權存取權的方式執行。 在類 Unix 作業系統中，X Server 是最典型的例子。 它的 mode-setting 實作放在針對每種顯示卡類型所撰寫的 DDX driver 之中

這種作法後來被稱為 User space Mode-Setting 或 UMS，但它帶來了好幾個問題。 它不僅打破了作業系統應該在程式與硬體之間提供的隔離，造成穩定性與安全性上的疑慮，還可能在兩個或更多 user space 程式同時嘗試進行 mode-setting 時，把圖形硬體留在一個不一致的狀態

為了避免這些衝突，X Server 在實務上成為唯一會執行 mode-setting 操作的 user space 程式；其他 user space 程式則仰賴 X Server 來設定適當的 mode，並處理所有與 mode-setting 有關的其他操作。 一開始，mode-setting 只會在 X Server 啟動流程中執行，但後來 X Server 也獲得了在執行中進行 mode-setting 的能力

XFree86 3.1.2 引入了 `XFree86-VidModeExtension` extension，讓任何 X client 都能向 X Server 請求更改 modeline（解析度）。 之後 VidMode extension 又被更通用的 `XRandR` extension 所取代

然而，在一套 Linux 系統中，負責做 mode-setting 的程式碼並不只有這些。 在系統開機過程中，Linux 核心必須為虛擬主控台設定一個最小的文字模式（這是依據 VESA BIOS extensions 所定義的標準模式）。 此外，Linux 核心的 framebuffer driver 裡也包含用來設定 framebuffer 裝置的 mode-setting 程式碼

為了避免 mode-setting 衝突，`XFree86` Server（以及後來的 `X.Org` Server）在使用者從圖形環境切換到文字虛擬主控台時，會先儲存自己的 mode-setting 狀態，等使用者切回 X 時再把它還原。 這個流程在切換的過程中會造成惱人的螢幕閃爍，而且有時還會失敗，導致輸出畫面毀損或完全無法使用

user space mode-setting 這種作法也帶來其他問題：

- suspend/resume 流程必須仰賴 user space 工具來還原之前的 mode。 只要其中任何一個程式失敗或當掉，就可能因為 modeset 設定錯誤而讓系統失去可用的顯示畫面，整台機器等於無法使用
- 當螢幕處於圖形模式時（例如 X 正在執行時），核心也無法在螢幕上顯示錯誤或除錯訊息，因為核心只知道 VESA BIOS 的標準文字模式
- 更迫切的問題是，越來越多圖形應用程式開始繞過 X Server，並且出現了其他 X 的圖形 stack 替代方案，讓系統中到處都多了一份 mode-setting 程式碼的複本

為了處理這些問題，mode-setting 程式碼被移入核心內部的一個單一位置，具體來說就是現有的 DRM 模組。 之後，每個行程──包含 X Server 在內──都應該透過命令請核心執行 mode-setting 操作，而由核心負責確保並行的操作不會導致狀態不一致。 新增到 DRM 模組、用來執行這些 mode-setting 操作的核心 API 與程式碼，被稱為 Kernel Mode-Setting（KMS）

Kernel Mode-Setting 帶來了好幾項好處。 最直接的一點，就是可以把重複的 mode-setting 程式碼移除，無論是在核心端（Linux console、`fbdev`）還是 user space 端（X Server 的 DDX drivers）。 KMS 也讓撰寫替代性的圖形系統變得更容易，因為它們不再需要自行實作一套 mode-setting 程式碼

透過集中化的模式管理，KMS 解決了在主控台與 X 之間切換，以及在不同 X 執行個體之間切換（fast user switching）時的螢幕閃爍問題。 由於 KMS 存在於核心中，它也能在開機過程一開始就被使用，避免在這些早期階段因 mode 變更而產生的閃爍

KMS 作為核心的一部分，讓它可以使用只有在 kernel space 中才有的資源，例如中斷。 比方說，由核心本身負責 suspend/resume 之後的 mode 回復，大幅簡化了這個流程，順帶也提升了安全性（不再需要具有 root 權限的 user space 工具）。 核心也能很容易地處理新顯示裝置的 hotplug，解決了長久以來的老問題

mode-setting 也和記憶體管理緊密相關──因為 framebuffer 基本上就是記憶體緩衝區──因此和圖形記憶體管理器的緊密整合是非常被建議的。 這也是為什麼 kernel mode-setting 程式碼會被併入 DRM，而不是做成一個獨立子系統的主要原因

為了避免破壞既有 DRM API 的相容性，Kernel Mode-Setting 是以某些 DRM driver 的額外功能來提供的。 任何 DRM driver 在向 DRM core 註冊時，都可以選擇提供 `DRIVER_MODESET` 這個旗標，以表示它支援 KMS API。 那些實作了 Kernel Mode-Setting 的 driver 通常被稱為 KMS drivers，用來區分舊式（不具 KMS）的 DRM drivers

KMS 的採用程度已經高到這樣一種地步：某些缺乏 3D 加速能力（或者硬體廠商不想公開或不想實作 3D 加速）的 driver，仍然會只實作 KMS API 而不實作 DRM API 的其餘部分，藉此讓顯示 server（例如 Wayland）可以輕鬆運作

#### KMS device model

KMS 會把輸出裝置建模並管理為一組抽象的硬體區塊，這些區塊通常出現在顯示控制器的顯示輸出管線上。 這些區塊包括：

- CRTC：每一個 CRTC（源自 CRT Controller）代表顯示控制器中的一個 scanout 引擎，它會指向一個 scanout 緩衝區（framebuffer）。 CRTC 的用途是在 PLL 電路的協助下，讀取目前位於 scanout 緩衝區中的像素資料，並據此產生視訊模式的時序訊號
  
  可用的 CRTC 數量決定硬體能同時處理多少個獨立輸出裝置，因此要使用 multi-head 設定時，每個顯示裝置至少需要一個 CRTC。 如果多個 CRTC 都從同一個 framebuffer 做 scanout，則兩個（或更多）CRTC 也可以以 clone 模式運作，把相同的影像送到多個輸出裝置上
- Connectors：connector 代表顯示控制器把 scanout 作業產生的視訊訊號送往顯示的位置。 通常在 KMS 中的 connector 概念，對應到硬體上的某個實體連接埠（VGA、DVI、FPD-Link、HDMI、DisplayPort、S-Video 等），而輸出裝置（顯示器、筆電面板等）會永久或暫時接在這些連接埠上
  
  與目前實體接上的輸出裝置相關的資訊──例如連線狀態、EDID 資料、DPMS 狀態或支援的視訊模式──也都儲存在這個 connector 物件之中
- Encoders：顯示控制器必須把來自 CRTC 的視訊模式時序訊號，以適合目標 connector 的格式進行編碼。 encoder 代表能執行其中一種編碼方式的硬體區塊。 以數位輸出為例，常見的編碼包括 TMDS 與 LVDS；對於 VGA、TV out 這類類比輸出，則通常會使用特定的 DAC 區塊
  
  每一個 connector 在同一時間只能從一個 encoder 接收訊號，而且每種 connector 也只支援部分編碼格式。 此外，實體上也可能存在額外的限制，導致不是每一個 CRTC 都能連到所有可用的 encoder，從而限制了 CRTC–encoder–connector 的可用組合
- Planes：plane 本身不是一個硬體區塊，而是一個記憶體物件，裡面包含供 scanout 引擎（CRTC）讀取的緩衝區。 持有 framebuffer 的 plane 稱為 primary plane，而每個 CRTC 都必須有一個對應的 primary plane
  
  因為它是 CRTC 用來決定視訊模式的來源──包括顯示解析度（寬與高）、像素大小、像素格式、重新整理率等。 如果顯示控制器支援硬體游標疊加，CRTC 也可能會有對應的 cursor planes；如果它能從額外的硬體 overlay 做 scanout，並在輸出給顯示裝置的過程中「on the fly」合成或混合，則還會有 secondary planes

#### Atomic Display

近年來，社群持續投入心力，試圖讓與 KMS API 有關的一些常見操作具備原子性，特別是 mode setting 與 page flipping 這兩類操作。 這套強化後的 KMS API 就是所謂的 Atomic Display（先前稱為 atomic mode-setting 以及 atomic 或 nuclear pageflip）

atomic mode-setting 的目的，是在具有多重限制的複雜設定中，透過避免那些可能導致視訊狀態變得不一致或無效的中間步驟，來確保 mode 能被正確地變更； 它也避免了在 mode-setting 失敗並且必須回復（rollback）時產生高風險的視訊狀態。 :9 

atomic mode-setting 透過提供 mode 測試的能力，讓我們可以事先得知某個特定的 mode 設定是否合適。 當某個 atomic mode 已經過測試並確認有效後，就可以透過一次不可分割（atomic）的 commit 操作來套用。 測試與 commit 這兩種操作是由同一個新的 `ioctl` 提供，只是使用不同的旗標

另一方面，atomic page flip 則允許在同一個輸出上更新多個 planes（例如 primary plane、cursor plane，以及可能存在的 overlay 或 secondary planes），而且全部都在同一個 VBLANK 區間中同步完成，從而確保顯示正確且不會產生畫面撕裂。 :9,14 這個需求對於行動與嵌入式的顯示控制器特別重要，因為它們往往會使用多個 planes/overlays 來節省電力

新的 atomic API 是建立在舊有 KMS API 之上的。 它使用相同的模型與物件（CRTC、encoder、connector、plane 等），但可被修改的物件屬性數量不斷增加

atomic 程序的做法，是先修改相關屬性，去構成我們想要測試或 commit 的狀態。 具體要修改哪些屬性，取決於我們是要做 mode-setting（多半是 CRTC、encoder 與 connector 的屬性），還是要做 page flipping（通常是 planes 的屬性）。 兩種情況使用的 `ioctl` 是同一個，只是每次呼叫所附帶的屬性清單不同而已

### Render nodes

在原始的 DRM API 中，DRM 裝置 `/dev/dri/cardX` 會同時用於具特權的操作（modesetting、其他顯示控制）以及非特權的操作（rendering、GPGPU 計算）。 基於安全性考量，開啟對應的 DRM 裝置檔需要具備「相當於 root 權限」的特殊權限

這導致整體架構變成只有少數可靠的 user space 程式（X server、圖形 compositor 等）可以完整存取 DRM API，包括像 modeset API 這類具特權的部分。 其他想要進行算繪或 GPGPU 計算的 user space 應用程式，必須透過一個特殊的認證介面，由 DRM 裝置的擁有者（「DRM Master」）授權

之後，這些已通過認證的應用程式，就能使用一個不含特權操作的受限版本 DRM API 來做算繪或計算。 這種設計帶來一個嚴重限制：系統上必須永遠有一個圖形 server（X Server、Wayland compositor 等）執行中，擔任某個 DRM 裝置的 DRM-Master，如此其他 user space 程式才有機會被授權使用該裝置，即使在完全沒有任何圖形顯示需求、只做 GPGPU 計算的情境中也是如此

「render nodes」這個概念試圖藉由把 DRM 的 user space API 拆成兩組介面──一組具特權，一組非特權──並且為每組介面使用獨立的裝置檔（或稱「節點」），來解決上述情境。 對於系統中找到的每一個 GPU，如果對應的 DRM driver 支援 render nodes 功能，它就會在既有的 primary node `/dev/dri/cardX` 之外，再建立一個名為 `/dev/dri/renderDX` 的裝置檔，稱為 render node

採用 direct rendering 模型的 client，以及想要利用 GPU 計算能力的應用程式，只要擁有開啟裝置檔所需的檔案系統權限，就可以直接開啟任一現有的 render node，並透過該節點所支援的那個受限版 DRM API 子集來派送 GPU 操作，而不需要額外的特權

需要 modeset API 或其他特權操作的顯示 server、compositor 以及其他程式，則必須照往常一樣開啟標準的 primary node，藉此取得對完整 DRM API 的存取。 render nodes 會明確禁止 `GEM flink` 操作，以防止透過不安全的 GEM 全域名稱來分享緩衝區；只有 `PRIME`（`DMA-BUF`）檔案描述元可以用來與其他 client（包含圖形 server）分享緩衝區

### Hardware support

Linux DRM 子系統包含了自由且開放原始碼的 drivers，用來支援桌上型電腦三大 GPU 廠商（AMD、NVIDIA 與 Intel）的硬體，以及越來越多行動 GPU 與系統單晶片（SoC）整合商所推出的裝置。 各個 driver 的品質差異很大，取決於硬體製造商的合作程度以及其他種種因素

## 自由與開放原始碼圖形裝置驅動程式

自由與開放原始碼圖形裝置驅動程式是一個用來控制電腦圖形硬體的軟體 stack，支援各種圖形算繪的應用程式介面（API），並以自由與開放原始碼軟體授權條款釋出。 圖形裝置驅動程式會針對特定硬體撰寫，以在特定的作業系統核心之下運作，並支援一系列由應用程式用來存取圖形硬體的 API

若顯示驅動程式是圖形硬體的一部分，它們也可能負責控制輸出到顯示器的內容。 大多數自由與開放原始碼圖形裝置驅動程式是由 `Mesa` 專案開發。 這些驅動程式由編譯器、一個算繪 API，以及用來管理存取圖形硬體的軟體所組成

沒有自由（且合法）可得原始碼的驅動程式通常被稱為 binary drivers。 當 binary drivers 用於像 Linux 這類持續演進與變動的作業系統時，會替最終使用者以及套件維護者帶來問題。 這些問題會影響系統穩定性、安全性與效能，也是促使人們獨立開發自由與開放原始碼驅動程式的主因

當無法取得技術文件時，人們往往會透過「乾淨室（clean-room）」的方式進行逆向工程，來了解底層硬體。 基於這種理解，就能撰寫裝置驅動程式，並在法律上允許的任何軟體授權條款下公開釋出

在少數情況下，製造商的驅動程式原始碼雖然能在網路上取得，但並未採用自由授權條款。 這代表程式碼可以被研究並為個人用途進行修改，但修改後的（通常也包含原始的）程式碼無法自由散布。 對於驅動程式中錯誤的修補也無法輕易以修改版本的形式分享出去。 因此，相較於自由與開放原始碼驅動程式，這類驅動程式的實用性會大打折扣

### 專有驅動程式的問題

#### 軟體開發者的觀點

對於 binary-only 驅動程式，從著作權、安全性、可靠性與開發面向都存在不少反對意見。 身為對抗 binary blobs 廣泛運動的一部分，OpenBSD 的首席開發者 Theo de Raadt 曾指出，對於一個 binary 驅動程式來說，「當它壞掉時（而且它一定會壞掉），沒有任何方式可以修理它」；一個仰賴 binary drivers 的產品，一旦被製造商宣告為 end-of-life，就等於是「永遠壞掉」了

該專案也曾表示，binary drivers 會「藏起錯誤以及用來繞過錯誤的變通做法」，而這項觀察多少也被後來在 binary drivers 中發現的缺陷所證實（其中包含在 2006 年 10 月被 Rapid7 發現、可被利用的 Nvidia 3D 驅動程式錯誤）。 有人推測這個錯誤自 2004 年起就已存在；Nvidia 否認此說法，主張這個問題在 2006 年 7 月才被告知他們，而 2004 年的錯誤其實是 `X.Org` 中的 bug（而非 Nvidia 驅動程式中的 bug）

binary 驅動程式經常無法與最新版的開放原始碼軟體一同運作，而且幾乎不會支援開放原始碼軟體的開發快照；例如開發者通常無法直接把 Nvidia 或 ATI 的專有驅動程式拿來搭配某個 X server 的開發快照，或是 Linux kernel 的開發快照使用。 像 kernel mode-setting 這類功能也無法由廠商以外的人加入 binary 驅動之中，若廠商缺乏能力或興趣，就會導致這類功能無法被納入

在 Linux 核心開發社群中，Linus Torvalds 對 binary-only 模組的議題曾做出強硬表態：「我完全不會考慮因為某個 binary-only 模組就把自己的手腳綁住……我希望大家知道，當他們使用 binary-only 模組時，那是他們自己的問題。 」

另一位核心開發者 Greg Kroah-Hartman 則表示，binary-only 核心模組並不符合核心的授權條款（GNU 通用公共授權條款，GPL）；它「就是因為衍生著作、連結等各種有趣的理由而違反 GPL。」

作家兼電腦科學家 Peter Gutmann 則對微軟 Windows Vista 作業系統中的數位權利管理機制表示憂心，認為此機制可能會限制撰寫開放驅動程式所需文件的取得，因為它「要求必須將裝置運作細節保密。 」

在 binary 驅動程式的案例中，人們會基於自由軟體哲學、軟體品質與安全性等理由提出反對意見。 2006 年時，Greg Kroah-Hartman 做出以下結論：

封閉原始碼的 Linux 核心模組是違法的。 就是這樣，非常簡單。 這些年來我很不幸和許多不同的智慧財產權律師討論過這個議題，而我談過的每一位都同意，今天沒有任何人能寫出一個可以封閉原始碼的 Linux 核心模組。 由於像衍生著作與連結這些有趣的因素，它就是會違反 GPL

Linux 核心從來沒有維護一個穩定的核心內 application binary interface（ABI）。 也有人擔心，專有驅動程式中可能存在後門，就像在 Samsung Galaxy 系列 modem 驅動程式中發現的那個一樣

#### 硬體開發者的觀點

當像 3D 遊戲引擎或 3D 電腦圖形軟體這類應用程式，把計算從 CPU 轉移到 GPU 時，它們通常會使用 `OpenGL` 或 `Direct3D` 這類特定用途的 API，而不是直接對硬體下手。 由於所有從 API 呼叫到 GPU opcode 的轉換都在裝置驅動程式裡完成，驅動程式中包含了專門的知識，也因此成為最佳化的重點

由於專有驅動程式開發長期以來的僵化歷史，近年來出現了一波由社群支援的桌上型與行動 GPU 裝置驅動程式。 像 `FOSSi`、`LowRISC` 等自由與開放硬體組織，也會從開放圖形硬體標準的發展中獲益。 這樣一來，電腦製造商、玩家與其他相關人士就能擁有一個完整且免權利金的平台，用來開發電腦硬體與相關裝置

桌上型電腦市場長期由使用 x86/x86-64 指令集的 PC 硬體以及可用於 PC 的 GPU 所主宰，主要有三家競爭對手（Nvidia、AMD 與 Intel）。 競爭的主要因素是硬體價格與 3D 電腦遊戲中的原始效能，而這又大幅受到「將 API 呼叫有效轉譯為 GPU opcodes」之能力的影響

顯示驅動程式與視訊解碼器是顯示卡固有的一部分：這些硬體被設計用來協助進行視訊串流解碼所需的計算。 隨著 PC 硬體市場萎縮，似乎不太可能再有新的競爭者投入這個市場，而且也不清楚一家公司在看到其他公司驅動程式的原始碼後，還能從中獲得多少額外知識

行動領域則是另一種情況。 各個功能區塊（應用程式專用積體電路的顯示驅動器、2D 與 3D 加速，以及視訊解碼與編碼）是晶片上彼此分離的半導體智慧財產（SIP）區塊，因為硬體裝置差異相當大；例如某些行動媒體播放機需要的是能加速視訊解碼的顯示驅動器，但不需要 3D 加速

這裡的開發目標不只是原始 3D 效能，還包含系統整合、電力消耗與 2D 能力。 也有人嘗試放棄傳統以 Vsync 更新顯示的方式，改以更善用 sample-and-hold 技術的方式來降低耗電

2013 年第二季，全球銷售的智慧型手機中有 79.3% 採用某個版本的 Android 作業系統，而 Linux 核心則是智慧型手機領域的主流。 硬體開發者確實有動機為自己的硬體提供 Linux 驅動程式，但由於競爭關係，卻缺乏將這些驅動程式做成自由與開放原始碼的誘因

另一項問題是 Android 對 Linux 核心做的特定擴充尚未被 mainline 接受，例如 Atomic Display Framework（`ADF`）。 `ADF` 是 3.10 版 AOSP 核心中的一項功能，它在 Android 的 `hwcomposer` HAL 與核心驅動程式之間提供一個以 `dma-buf` 為中心的 framework

`ADF` 與 `DRM-KMS` framework 存在顯著重疊。 `ADF` 並未被主線核心接受，但另一組解法（稱為 atomic mode setting），針對相同問題提出了不同的方案，目前仍在開發中。 像 `libhybris` 這類專案則嘗試利用 Android 裝置驅動程式，讓它們可以在 Android 以外的 Linux 平台上運作

### 軟體架構

自由與開放原始碼驅動程式主要是在 Linux 上，由 Linux 核心開發者、第三方程式設計愛好者以及像 Advanced Micro Devices 這類公司的員工所開發。 每一個驅動程式大致上可分為五個部分：

- 一個 Linux 核心元件 `DRM`
- 一個 Linux 核心元件 `KMS` 驅動程式（顯示控制器驅動程式）
- 一個 user space 的 `libDRM` 元件（`DRM` 系統呼叫的 wrapper 函式庫，理論上只應由 `Mesa 3D` 使用）
- 一個 user space 的 `Mesa 3D` 元件。 這個元件與硬體相關，它在 CPU 上執行，並把 `OpenGL` 命令（例如）轉換成 GPU 的機器碼。 由於裝置驅動程式被切分成多個部分，因此可以進行 marshalling
  
  `Mesa 3D` 是唯一同時提供 `OpenGL`、`OpenGL ES`、`OpenVG`、`GLX`、`EGL` 與 `OpenCL` 的自由與開放原始碼實作。 在 2014 年 7 月，多數元件都已符合 `Gallium3D` 的規格
  
  一個完整可用的 `Direct3D` 9 版 State Tracker 是以 C 撰寫，而一個不再維護的 `Direct3D` 10 與 11 版 tracker 則是以 C++ 撰寫。 `Wine` 本身具備 `Direct3D` 9 版本的支援。 `Wine` 的另一個元件會把 `Direct3D` 呼叫轉換為 `OpenGL` 呼叫，並搭配 `OpenGL` 一起運作
- `Device Dependent X`（`DDX`），另一個用於 `X.Org Server` 的 2D 圖形裝置驅動程式

`DRM` 是特定於核心的。 一般來說，各個作業系統都會提供一個 `VESA` 驅動程式。 `VESA` 驅動程式在沒有硬體加速的情況下支援大部分顯示卡，顯示解析度則受到製造商在 Video BIOS 中預先設定的一組模式所限制

### 歷史

Linux 圖形 stack 的演進曾被 X Window System 的核心通訊協定帶離原本的路徑

### 自由與開放原始碼驅動程式

#### ATI 與 AMD

##### Radeon

另見：List of AMD graphics processing units 與 List of AMD accelerated processing unit microprocessors

AMD 為其 `Radeon` 顯示卡提供一套專有驅動程式 AMD Catalyst，可用於 Microsoft Windows 與 Linux（先前稱為 `fglrx`）。 最新版本可以從 AMD 官網下載，也有一些 Linux 發行版會在其套件庫中收錄這套驅動程式。 目前它正逐步被一套名為 `AMDGPU-PRO` 的混合驅動程式取代，這套驅動程式把開放原始碼的核心、X 與 `Mesa` 多媒體驅動程式，與源自 Catalyst 的封閉原始碼 `OpenGL`、`OpenCL` 與 `Vulkan` 驅動程式結合在一起

用於 ATI–AMD GPU 的 FOSS 驅動程式在開發上統稱為 Radeon（`xf86-video-ati` 或 `xserver-xorg-video-radeon`）。 不過，這些驅動程式仍然必須將專有 microcode 載入 GPU 才能啟用硬體加速。 [驗證失敗]

Radeon 的 3D 程式碼依照 GPU 技術被分成六個驅動程式：`radeon`、`r200` 與 `r300` 這三個 classic 驅動程式，以及 `r300g`、`r600g` 與 `radeonsi` 這三個 `Gallium3D` 驅動程式：

- `Radeon` 支援 R100 系列
- `R200` 支援 R200 系列
- `R300g` 支援尚未採用 unified shader model 微架構的 R300、R400 與 R500
- `R600g` 支援所有以 TeraScale（VLIW5/4）為基礎的 GPU：R600、R700、HD 5000（Evergreen）與 HD 6000（Northern Islands）
- `Radeonsi` 支援所有以 Graphics Core Next 為基礎的 GPU：HD 7000、HD 8000 與 Rx 200（Southern Islands、Sea Islands 與 Volcanic Islands）

目前有一份最新的功能對照表可供查閱，並且已有對 Video Coding Engine 與 Unified Video Decoder 的支援。 自由與開放原始碼的 Radeon 圖形裝置驅動程式並非透過逆向工程取得，而是根據 AMD 所釋出的技術文件開發，而且開發者不必簽署保密協議（NDA）。 關於這些 GPU 的文件自 2007 年起陸續釋出

除了提供必要的技術文件外，AMD 的員工也會貢獻程式碼來支援自家硬體與各種功能

Radeon 圖形裝置驅動程式的所有元件皆由核心貢獻者與世界各地有興趣的開發者共同開發。 2011 年時，`r300g` 在某些情況下的效能甚至超過 Catalyst

##### AMDGPU

主條目：`AMDGPU`

在 2014 年 Game Developers Conference 上，AMD 宣布他們正在考慮採取策略轉變，把 Catalyst 的 user space 部分改以自由與開放原始碼的 `DRM` 核心模組為基礎，而不是使用專有的核心 blob

新的 `AMDGPU` 核心模組與整個 stack 的釋出工作於 2015 年 4 月在 `dri-devel` 郵件列表上宣布。 雖然 `AMDGPU` 正式支援的只有 GCN 1.2 以及之後的顯示卡，但對於原本只由 Radeon 驅動程式正式支援的 GCN 1.0 與 1.1 顯示卡，也可以透過設定 kernel 參數來啟用實驗性支援。 自 `libdrm` 2.4.63 版起，額外加入了一個分開的 `libdrm-amdgpu`

前一段中提到的 `radeonsi` 3D 程式碼也同時用在 `amdgpu` 上；這個 3D 驅動程式同時有 `radeon` 與 `amdgpu` 的後端

#### Nvidia

另見：List of Nvidia graphics processing units 與 `nouveau`

Nvidia 的專有驅動程式 Nvidia GeForce driver for GeForce 可用於 Windows x86/x86-64、Linux x86/x86-64/ARM、OS X 10.5 及之後版本、Solaris x86/x86-64，以及 FreeBSD x86/x86-64。 最新版本可以從網路上下載，也有一些 Linux 發行版會在其套件庫中收錄。 2013 年 10 月 4 日釋出的 beta 版 Nvidia GeForce driver 331.13 支援 `EGL` 介面，使其能在該驅動程式的配合下支援 Wayland

Nvidia 的自由與開放原始碼驅動程式名為 `nv`。 它的功能相當有限（只支援 2D 加速），而 Matthew Garrett、Dirk Hohndel 等人則形容其原始碼相當難以理解。 Nvidia 在 2010 年 3 月決定停止維護 `nv`，不再為 Fermi 或更晚期的 GPU 以及 DisplayPort 增加支援

2009 年 12 月，Nvidia 宣布他們不會支持自由圖形相關的倡議。 2013 年 9 月 23 日，公司宣布他們將釋出部分 GPU 的技術文件

`Nouveau` 幾乎完全是基於透過逆向工程取得的資訊。 這個專案的目標是使用 `Gallium3D` 來為 X.Org/Wayland 提供 3D 加速。 2012 年 3 月 26 日，`Nouveau` 的 DRM 元件被標記為穩定，並從 Linux 核心的 staging 區正式移

`Nouveau` 支援基於 Tesla（及更早）、Fermi、Kepler 與 Maxwell 的 GPU。 2014 年 1 月 31 日，Nvidia 員工 Alexandre Courbot 提交了一組大幅的 patch，為 `Nouveau` 加入對 GK20A（Tegra K1）的初始支援。 2014 年 6 月，Codethink reportedly 在 Tegra K1 上使用 Linux kernel 3.15 搭配 `EGL` 與「完全 100% 開放原始碼的圖形驅動 stack」，成功執行以 Wayland 為基礎的 Weston compositor

目前也有一份功能對照表可供查閱。 在 2014 年 7 月，由於缺乏 re-clocking 支援，`Nouveau` 在效能上仍然無法超越 Nvidia GeForce driver。 `Tegra-re` 則是一個專案，致力於對 Nvidia 的 VLIW 架構 Tegra GPU（早於 Tegra K1 的系列）進行逆向工程

Nvidia 會透過 OEM 廠商以及其 Linux for Tegra（先前稱為 `L4T`）開發套件來散布 Tegra 的專有裝置驅動程式。 Nvidia 與合作夥伴 Avionic Design 在 2012 年 4 月，一同努力將 `Grate`（用於 Tegra 的自由與開放原始碼驅動程式）送入 mainline Linux 核心

公司共同創辦人兼執行長則在 2013 年 GPU Technology Conference 上，以 Ubuntu Unity 展示了 Tegra 處理器的產品藍圖

Nvidia 的 Unified Memory 驅動程式（`nvidia-uvm.ko`），在 Linux 上為 Pascal 與 Volta GPU 實作記憶體管理，其授權條款為 MIT。 對於支援 `nvidia-uvm.ko` 的系統，這份原始碼可以在 Nvidia 的 Linux 驅動程式下載頁面中取得

2022 年 5 月，Nvidia 宣布一項新計畫與政策，將以 GPL–MIT 雙授權條款開放其 GPU Loadable Kernel Modules 的原始碼，但僅限於新的 GPU 型號，且一開始只有 alpha 品質。 官方同時表示：「這些變更只影響核心模組，user-mode 元件則保持不變

user-mode 仍為封閉原始碼，並會以預先編譯的二進位檔形式隨驅動程式與 CUDA 工具包一同發布。 」 之後，這套開放原始碼驅動程式已被提升為可用於正式環境的等級，並且現在正式被建議用於 RTX 20 系列與後續 GPU。 Blackwell（RTX 50 世代）以及之後的 NVIDIA GPU 架構則僅由這套開放原始碼驅動程式支援

#### Intel

另見：List of Intel graphics processing units、Intel GMA § Linux 與 Intel Graphics Technology

除了自家採用 PowerVR 的晶片外，Intel 一向有自行開發（或委託開發）自家圖形晶片開放原始碼驅動程式的傳統。 它們的 2D X.Org 驅動程式名為 `xf86-video-intel`。 Linux 核心中的 kernel mode-setting 驅動程式在切換視訊模式時不會使用 Video BIOS；由於某些 BIOS 支援的模式範圍有限，這樣的做法可使 Intel 顯示介面卡所支援的模式更容易且更可靠地被使用

公司也積極針對自由 Linux 驅動程式進行效能最佳化，使其能逼近 Windows 上的對應驅動程式，特別是在 Sandy Bridge 與更新的硬體上，2011 年時已能在某些任務上讓 Intel 驅動程式的表現超越其專有的 Windows 驅動。 其中部分效能最佳化也可能讓較舊硬體的使用者受惠

對 Intel 的 LLC（Last Level Cache、L4-Cache、Crystalwell 與 Iris Pro）的支援是在 Linux kernel 3.12 中加入的。 2013 年時，公司大約有 20 到 30 名全職的 Linux 圖形開發人員

#### Matrox

Matrox 開發並製造 Matrox Mystique、Parhelia、G200、G400 與 G550 等產品。 雖然該公司有為自家晶片開發 G550 之前的自由與開放原始碼驅動程式，但 G550 之後的晶片則是由封閉原始碼驅動程式支援

#### S3 Graphics

S3 Graphics 開發了 S3 Trio、ViRGE、Savage 與 Chrome，這些晶片由 `OpenChrome` 所支援

#### Arm Ltd

Arm Ltd 是一家無晶圓廠（fabless）的半導體公司，授權半導體智慧財產核心。 儘管它們以授權 ARM 指令集與基於 ARM 的 CPU 聞名，但也同時開發並授權 Mali 系列 GPU，以及較新的 Imortalis GPU，後者支援光線追蹤。 2012 年 1 月 21 日，Phoronix 報導 Luc Verhaegen 正在推動一項針對 Arm Mali 系列 GPU（特別是 Mali-200 與 Mali-400 版本）的逆向工程計畫

這個逆向工程專案被稱為 `Lima`，並於 2012 年 2 月 4 日在 FOSDEM 上進行發表。 2013 年 2 月 2 日，Verhaegen 展示了在 `Lima` 驅動程式上執行 Quake III Arena timedemo 模式的成果。 2018 年 5 月，一位 `Lima` 開發者提交了將該驅動程式納入 Linux 核心的補丁。 截至 2019 年 5 月，`Lima` 驅動程式已成為 mainline Linux 核心的一部分

`Panfrost` 是一個針對 Mali Txxx（Midgard）與 Gxx（Bifrost）GPU 的逆向工程驅動專案。 《Introducing Panfrost》演講於 2018 年的 X.Org Developer's Conference 上發表。 自 2019 年 5 月起，`Panfrost` 驅動程式也已成為 mainline Linux 核心的一部分

ARM 本身並未表示有意以自由與開放原始碼授權條款來支援其圖形加速硬體。 然而，ARM 的員工在 2015 年 12 月與 2016 年 4 月，曾送出補丁來為 Linux 核心加入對 ARM HDLCD 顯示控制器與 Mali DP500、DP550 及 DP650 SIP 區塊的支援

#### Imagination Technologies

Imagination Technologies 是一家無晶圓廠半導體公司，負責開發與授權半導體智慧財產核心，其中包含 PowerVR GPU。 Intel 曾製造多款基於 PowerVR 的 GPU。 PowerVR GPU 被廣泛使用在行動系統單晶片（SoC）裝置上

由於它在嵌入式裝置中的廣泛使用，Free Software Foundation 已將對 PowerVR 驅動程式進行逆向工程列入其高優先順序專案清單。 截至 2022 年 3 月，Imagination 已為其 2014 年推出、基於 Rogue 架構的 PowerVR GX6250，以及較新的 A-Series 架構 AXE-1-16M 與 BXS-4-64 GPU 提供 FOSS 驅動程式

#### Vivante

另見：Vivante GCxxxx

Vivante Corporation 是一家無晶圓廠半導體公司，授權半導體智慧財產核心並開發 GCxxxx 系列 GPU。 一套 Vivante 專有、封閉原始碼 Linux 驅動程式由 kernel space 與 user space 兩個部分組成。 雖然核心元件是開放原始碼（GPL），但 user space 元件──包含 GLES(2) 實作與 HAL 函式庫──並非開放原始碼；這些部分才是驅動程式邏輯的主要所在

Wladimir J. van der Laan 透過研究這些二進位 blobs 的行為、檢視與修改命令串流 dump，找出並記錄了狀態位元、命令串流以及 shader ISA。 `Etnaviv` `Gallium3D` 驅動程式正是基於這份文件撰寫而成。 Van der Laan 的工作受到 `Lima` 驅動程式的啟發，該專案已產出一個功能可用但尚未最佳化的 `Gallium3D` `LLVM` 驅動程式

`Etnaviv` 驅動程式在某些效能測試中表現優於 Vivante 的專有程式碼，並支援 Vivante GC400、GC800、GC1000、GC2000、GC3000 與 GC7000 系列。 2017 年 1 月，`Etnaviv` 被加入 `Mesa`，同時提供 `OpenGL ES 2.0` 與 Desktop OpenGL 2.1 支援

#### Qualcomm

另見：Adreno

Qualcomm 開發了 Adreno（先前稱為 ATI Imageon）行動 GPU 系列，並將其納入自家 Snapdragon 行動 SoC 系列之中。 2012 年，Phoronix 與 Slashdot 報導指出，Rob Clark 受到 `Lima` 驅動程式的啟發，正在為 Adreno GPU 系列進行驅動程式逆向工程。 在一篇被引用的部落格文章中，Clark 表示他是在自己的空閒時間進行這個專案，且 Qualcomm 平台是他唯一有可能針對開放 3D 圖形進行實作的目標

他的雇主（Texas Instruments 與 Linaro）與 Imagination PowerVR 與 ARM Mali cores 有合作關係，原本應該是他主要的開發對象；他已經有可用的 2D 支援命令串流，而 3D 命令看起來具有相同特性。 驅動程式原始碼最初發佈在 Gitorious 上，專案名稱為 `freedreno`，之後被移入 `Mesa`

2012 年，功能正常的 shader assembler 已經完成； 之後又基於逆向工程出的 shader compiler 開發了用於 texture mapping 與 phong shading 的示範版本。 Clark 於 2013 年 2 月 2 日的 FOSDEM 上，展示了在 `Freedreno` 上執行桌面 compositing、XBMC 媒體播放器與 Quake III Arena 的成果

2013 年 8 月，`freedreno` 的核心元件（MSM 驅動程式）被接受進 mainline，並自 Linux kernel 3.12 起可供使用。 DDX 驅動程式於 2014 年 7 月加入了對 server-managed file descriptor 的支援，需要 `X.Org Server` 版本 1.16 以上

2016 年 1 月，`Mesa` 的 `Gallium3D` 風格驅動程式加入了對 Adreno 430 的支援； 同年 11 月又加入了 Adreno 500 系列的支援。 `Freedreno` 可用於像 96Boards Dragonboard 410c 與 Nexus 7（2013）這類裝置上，在傳統 Linux 發行版（如 Debian 與 Fedora）以及 Android 平台中運作

#### Broadcom

另見：VideoCore

Broadcom 在其 SoC 中開發並設計 VideoCore GPU 系列。 由於它被用在 Raspberry Pi 上，因此社群對於 VideoCore 的 FOSS 驅動程式有相當高的興趣。 Raspberry Pi 基金會與 Broadcom 合作，於 2012 年 10 月 24 日宣布他們已開放「所有用來驅動 GPU 的 ARM（CPU）端程式碼」為開放原始碼

不過，根據 `Lima` 逆向工程驅動程式作者的說法，這項公告有些誤導；新開放原始碼的元件只提供 ARM CPU 與 VideoCore 之間的訊息傳遞能力，對於了解 VideoCore 本身或增加可程式性幫助不大

VideoCore GPU 執行的是一個 RTOS，負責處理各種工作；視訊加速則由執行在這個專有 GPU 上的 RTOS 韌體完成，而這套韌體在當時並未一併開放原始碼。 由於當時既沒有以該專有 GPU 為目標的 toolchain，也沒有文件化的指令集，即使韌體原始碼開放，也沒有辦法從中獲得太多實際好處。 `Videocoreiv` 專案 則嘗試為 VideoCore GPU 撰寫文件

2014 年 2 月 28 日（Raspberry Pi 問世滿兩週年），Broadcom 與 Raspberry Pi 基金會宣布釋出 VideoCore IV graphics core 的完整文件，以及整套圖形 stack 的原始碼，授權條款為 3-clause BSD。 這套採用自由授權條款的 3D 圖形程式碼於 2014 年 8 月 29 日被提交到 `Mesa`，並首次出現在 `Mesa` 10.3 版中

#### 其他廠商

雖然 Silicon Integrated Systems 與 VIA Technologies 表示過對開放原始碼驅動程式的興趣有限，但兩家公司仍有釋出部分原始碼，並在 FOSS 開發者的推動下整合進 `X.Org`。 2008 年 7 月，VIA 開放了其產品的技術文件，藉此改善在 Linux 與開放原始碼社群中的形象

然而，該公司並未與開放原始碼社群妥善合作來提供技術文件與可用的 DRM 驅動程式，使得人們對 Linux 支援的期待落空。 2011 年 1 月 6 日，有消息指出 VIA 不再有意支援自由圖形相關的倡議

DisplayLink 宣布了一個名為 `Libdlo` 的開放原始碼專案，目標是在 Linux 與其他平台上支援其 USB 圖形技術。 這個專案的程式碼以 LGPL 授權釋出，但尚未被整合進任何 `X.Org` 驅動程式中。 DisplayLink 圖形支援目前可透過 mainline 核心中的 `udlfb` 驅動程式（搭配 `fbdev`），以及 `udl/drm` 驅動程式取得，後者在 2012 年 3 月時僅存在於 `drm-next` 分支中

非硬體相關的廠商也可能協助自由圖形的發展。 Red Hat 有兩名全職員工（David Airlie 與 Jérôme Glisse）負責 Radeon 軟體的開發，而 Fedora 專案在發行新版 Linux 發行版之前，會舉辦 Fedora Graphics Test Week 活動來測試自由圖形驅動程式。 其他提供開發或支援的公司則包括 Novell 與 VMware

### 開放硬體專案

`Project VGA` 的目標是打造一張低成本、開放原始碼的 VGA 相容顯示卡。 `Open Graphics Project` 則以建立一個開放硬體 GPU 為目標。 2010 年 9 月，首批 25 片 OGD1 卡釋出，供人申請補助或購買。 `Milkymist` 系統單晶片則以嵌入式圖形而非桌面電腦為目標，支援 VGA 輸出、一個功能有限的 vertex shader，以及一個 2D 貼圖單元

`Nyuzi` 是一個實驗性的 GPGPU 處理器，包含以 SystemVerilog 撰寫的可合成硬體設計、一個指令集模擬器、一個基於 `LLVM` 的 C/C++ 編譯器、軟體函式庫與測試套件，用來探索平行軟硬體的設計。 它可以在 Terasic DE2-115 FPGA 開發板上執行

若一個專案使用 FPGA，通常會包含部分（或全部）封閉原始碼的 toolchain。 然而，目前已有數個針對 Lattice FPGA 的開放原始碼 toolchain 可用（特別是 iCE40 與 ECP5 板卡），分別使用 `Project IceStorm` 與 `Trellis`。 同時也有一個規模更大的持續性專案，目標是打造 FPGA 世界裡的「GCC」，稱為 `SymbiFlow`，其中包含前述的 FPGA toolchain，以及一個仍在早期階段、用於 Xilinx FPGA 的開放原始碼 toolchain

## GPU 虛擬化

GPU 虛擬化是指一系列技術，允許在虛擬機器上執行的圖形或 GPGPU 應用程式能夠使用 GPU 來加速。 GPU 虛擬化被用在各種應用當中，例如桌面虛擬化、雲端遊戲，以及計算科學（例如流體動力學模擬）

GPU 虛擬化的實作通常會採用以下一種或多種技術：裝置模擬（device emulation）、API remoting、固定 pass-through（fixed pass-through）以及媒介式 pass-through（mediated pass-through）。 在虛擬機與 GPU 的整合比、圖形加速能力、算繪忠實度與功能支援度、跨不同硬體的可攜性、虛擬機之間的隔離性、以及支援暫停/恢復與即時遷移等面向上，每一種技術都會帶來不同的取捨

### API remoting

在 API remoting（也稱為 API forwarding）中，guest 應用程式對圖形 API 的呼叫會透過遠端程序呼叫轉送到 host，由 host 代表多個 guest 執行圖形命令，並以 host 的 GPU 當作單一使用者來使用

當 API remoting 與裝置模擬結合時，也可以被視為一種半虛擬化（paravirtualization）形式。 當 GPU 不支援硬體輔助虛擬化時，這種技術允許在多個 guest 與 host 之間共享 GPU 資源。 這種作法在概念上相對容易實作，但也有數個缺點：

- 在純粹的 API remoting 中，虛擬機在存取圖形 API 時幾乎沒有隔離性；可以透過半虛擬化來改善隔離
- 在每個 frame 會發出大量繪圖呼叫的應用程式中，其效能可能從原生效能的 86% 低到只有 12%
- 需要轉送的大量 API 進入點可能很複雜，若僅部分實作某些進入點，會降低算繪的忠實度
- guest 上的應用程式可能會被限制只能使用少數可用的 API

為了最大化效能並將延遲降到最低，hypervisor 通常會在 guest 與 host 之間使用 shared memory。 若改成使用網路介面（這在分散式算繪中是常見作法），第三方軟體可以額外支援特定的 API（例如用於 CUDA 的 `rCUDA`），或在 hypervisor 的軟體套件尚未支援常見 API 時，加入典型 API 的支援（例如用於 OpenGL 的 `VMGL`）。 不過，網路延遲與序列化的額外負擔可能會抵銷這些好處

#### Application support from API remoting virtualization technologies

各種 API remoting 虛擬化技術對應的應用程式支援情況如下：

| 技術 | Direct3D | OpenGL | Vulkan | OpenCL | DXVA |
| --- | --- | --- | --- | --- | --- |
| VMware Virtual Shared Graphics Acceleration (vSGA) | 11 | 4.3 | Yes | No | No |
| Parallels Desktop for Mac 3D acceleration | 11\[A] | 3.3\[B] | No | No | No |
| Hyper-V RemoteFX vGPU | 12 | 4.4 | No | 1.1 | No |
| VirtualBox Guest Additions 3D driver | 8/9\[C] | 2.1\[D] | No | No | No |
| Thincast Workstation - Virtual 3D | 12.1 | No | Yes | No | No |
| QEMU/KVM with Virgil 3D | No | 4.3 | Planned | No | No |

- A. 使用 `WineD3D` 封裝成 `OpenGL`
- B. 相容性設定檔
- C. 實驗性。 使用 `WineD3D` 封裝成 `OpenGL`
- D. 實驗性

### Fixed pass-through

在 fixed pass-through 或 GPU pass-through（PCI pass-through 的一種特殊情況）中，一張 GPU 會被單一虛擬機器直接存取，而且是獨佔且永久性的。 這種技術可以達到原生效能的 96–100%， 並且具有高算繪忠實度， 但 GPU 所提供的加速無法在多個虛擬機之間共享。 因此，它的整合比最低、成本最高，因為每一台需要圖形加速的虛擬機都需要額外一張實體 GPU

以下軟體技術實作了 fixed pass-through：

- VMware Virtual Dedicated Graphics Acceleration (vDGA)[a]
- Parallels Workstation Extreme
- Hyper-V Discrete Device Assignment (DDA)
- Citrix XenServer GPU pass-through
- 搭配 Intel GVT-d 的 Xen 與 QEMU/KVM
- VirtualBox 自 6.1.0 版起移除對 PCI pass-through 的支援

#### QEMU/KVM

對某些 GPU 型號來說，Nvidia 與 AMD 顯示卡驅動程式會嘗試偵測 GPU 是否正被虛擬機器存取，並停用部分或全部 GPU 功能。 NVIDIA 近期已經改變針對消費級 GPU 的虛擬化規則，在 GeForce Game Ready 465.xx 版與之後的驅動程式中移除了這項檢查

##### NVIDIA

###### 桌機

在桌上型電腦中，多數顯示卡都可以被做 pass-through，不過對於使用 Pascal 架構或更早架構的顯示卡而言，如果該 GPU 也被用來啟動 host 系統，那麼其 VBIOS 就必須一併在虛擬機器中做 pass-through

###### 筆電

在筆記型電腦中，NVIDIA 驅動程式會透過 ACPI 檢查是否存在電池，如果沒有偵測到電池，就會回傳錯誤。 為了避免這種情況，需要從文字產生並轉成 Base64 的 `acpitable` 來偽造一顆電池，藉此繞過這項檢查

###### Pascal 及更早架構

對於使用 Pascal 或更早架構的筆電顯示卡而言，是否能做 pass-through 在很大程度上取決於顯示卡的實際配置。 對於沒有啟用 NVIDIA Optimus 的筆電（例如 MXM 版本），可以透過傳統方式達成 passthrough。 對於啟用 NVIDIA Optimus，且是透過 CPU 的整合式圖形 framebuffer 

而非 GPU 自己的 framebuffer 來輸出的筆電，passthrough 就複雜得多，需要使用遠端算繪顯示或服務、使用 Intel GVT-g，以及將 VBIOS 整合到開機設定之中，因為這類筆電的 VBIOS 會放在系統 BIOS 中，而不是在 GPU 本身

對於擁有 NVIDIA Optimus 且具備獨立 framebuffer 的筆電，其配置方式可能有所差異；如果能關閉 NVIDIA Optimus，就可以透過傳統方式達成 passthrough。 然而，如果唯一的配置就是啟用 Optimus，那麼 VBIOS 很可能同樣只存在於筆電的系統 BIOS 中，需要採取與僅使用整合式圖形 framebuffer 的筆電相同的步驟，不過在這種情況下也有可能使用外接螢幕

### Mediated pass-through

在 mediated device pass-through 或 full GPU virtualization 中，GPU 硬體會透過 IOMMU 為每個 guest 提供帶有虛擬記憶體範圍的 context，而 hypervisor 則會把各個 guest 的圖形命令直接送往 GPU。 這種技術是一種硬體輔助虛擬化形式，能達到接近原生[b] 的效能與高度的算繪忠實度

如果硬體能把各個 context 暴露成完整的邏輯裝置，那麼 guest 就能使用任意 API；否則，各種 API 與驅動程式就必須自行處理 GPU context 所帶來的額外複雜度。 其缺點之一，是在存取 GPU 資源時，虛擬機之間可能只有很少的隔離性

以下軟體與硬體技術實作了 mediated pass-through：

- VMware Virtual Shared Pass-Through Graphics Acceleration[a]，搭配 Nvidia vGPU 或 AMD MxGPU
- Citrix XenServer shared GPU，搭配 Nvidia vGPU、AMD MxGPU 或 Intel GVT-g
- 搭配 Intel GVT-g 的 Xen 與 KVM
- Thincast Workstation - Virtual 3D 功能（Direct X 12 與 Vulkan 3D API）

雖然 API remoting 一般可以用在目前與較舊的 GPU 上，但 mediated pass-through 則需要特定裝置所支援的硬體功能才能使用

#### Hardware support for mediated pass-through virtualization

支援 mediated pass-through 虛擬化的硬體如下表所示：

| 廠商 | 技術 | Server | Professional | Consumer | 整合式 GPU 家族 |
| --- | --- | --- | --- | --- | --- |
| Nvidia | vGPU | GRID, Tesla | Quadro | No | — |
| AMD | MxGPU | FirePro Server, Radeon Instinct | Radeon Pro | No | No |
| Intel | GVT-g | — | — | — | Broadwell and newer |

### Device emulation

GPU 架構非常複雜且演進快速，而且其內部細節通常是保密的。 對於新一代 GPU，一般而言無法做到完整的虛擬化，只能針對較舊且較簡單的世代來做。 例如，專門模擬 IBM PC 架構的模擬器 PCem，就能模擬支援 Direct3D 3 的 S3 ViRGE/DX 顯示裝置，以及支援 Glide 的 3dfx Voodoo2 等等

在使用 VGA 或 SVGA 虛擬顯示卡的情況下， guest 可能完全沒有 3D 圖形加速，只提供最低限度的功能，讓使用者能透過圖形終端機存取這台機器。 被模擬的裝置可能只會向 guest 暴露最基本的 2D 圖形模式。 虛擬機管理程式（virtual machine manager）也可能提供常見 API 的實作，並以軟體算繪的方式在 guest 上啟用 3D 圖形應用程式，不過其效能可能低到只有硬體加速原生效能的 3%。 下列軟體技術就是以軟體算繪的方式來實作圖形 API：

- VMware SVGA 3D software renderer
- VirtualBox VMSVGA graphics controller
- Citrix XenServer OpenGL Software Accelerator
- Windows Advanced Rasterization Platform
- Core OpenGL software renderer
- Mesa software renderer
- Swift Shader（實作 WebGPU 的軟體算繪器）
