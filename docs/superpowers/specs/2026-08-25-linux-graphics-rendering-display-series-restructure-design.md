# Learn graphic stack by virtio-gpu：Rendering／Display 系列重構設計

## 目標

這個系列稱為「Learn graphic stack by virtio-gpu」。 現有 PLAN 已經按照 Mesa、Xorg、Linux DRM／KMS、virtio-gpu 與 Wayland 等主要 owner 拆分文章。 這次重構會在這個基礎上加入一套所有文章共用的閱讀座標：一張畫面從 application 產生內容到顯示裝置發布結果時，會同時推進 Rendering 與 Display 兩項工作

- Rendering 負責解讀 graphics API、建立 rendering state 與 resources、產生 commands，最後算出 application image 或 compositor output image
- Display 負責管理視窗或 surface 的位置與可見狀態、安排 composition、選擇 scanout image，最後把結果發布到顯示輸出
- 兩項工作會在 buffer、image、layout metadata、同步資訊與 present request 等交接點會合

系列文章仍以 owner 為單位。 每篇只展開該 owner 內的 Rendering 與 Display 工作，再透過公開介面把結果交給下一個 owner。 這樣可以沿著同一條畫面路徑理解不同專案，也能讓 Mesa／OpenGL、Mesa／Vulkan、X11、Wayland、DRM／KMS 與 virtio-gpu 各自形成可獨立閱讀的文章

Unified HMI／RVGPU／DDFW 會另外形成一篇專案文章。 這個案例會展示 virtio-gpu 如何出現在原生 Linux、Wayland 與分散式顯示環境中，再說明 DDFW 如何從 control plane 管理 application lifecycle 與 layout

## 這次不會直接修改的內容

這份規格只決定系列架構、文章責任、內容搬移方式與圖片系統。 後續撰寫實作計畫以前，不會修改 `MesBlog/src/ComputerGraphic/Mesa/README.md` 的正文

目前已經逐段校過的 Big Picture 與 `## 本文的固定追蹤組態` 會作為重構基準。 後續調整會先建立內容與圖片清冊，再搬移既有段落。 已驗證的敘事、程式碼片段、callgraph、來源連結與技術結論不會因新的文章架構而直接消失

## virtio-gpu 如何貫穿整個系列

Virtio-gpu 是這個系列反覆使用的具體案例。 它同時提供 Rendering 與 Display 所需的介面，也會經過 Mesa、window system、Linux DRM／KMS、guest driver、device model 與 host renderer。 讀者可以沿著同一組 resources、commands、buffers 與 fences，觀察各個 owner 如何完成自己負責的工作

每篇核心文章會先說明該 owner 提供的通用架構，再沿 virtio-gpu 固定組態追蹤一條代表性路徑：

- Mesa／OpenGL 使用 VirGL driver 說明 OpenGL work 如何變成虛擬 GPU commands
- Linux DRM／KMS 使用 `virtio_gpu` driver 說明 render submission 與 virtual display state 如何經過 DRM core
- X11／Xorg 使用 modesetting、glamor、DRI3 與 Present，把 application image 寫進 virtio-gpu scanout storage
- Wayland／compositor 使用 virtio-gpu DRM device 作為 display backend 範例，說明 client buffer、composition 與 output publication
- Mesa／Vulkan 使用 Venus 說明 Vulkan commands 與 WSI image 如何進入 virtio-gpu 路徑
- virtio-gpu 專篇再完整展開 2D／3D protocol、Linux guest driver、VMM device model、virglrenderer 與 host display backend

Virtio-gpu 在其餘五篇核心文章中，是連接該篇 owner 與下一層的代表性案例。 第四篇則完整分析 virtio-gpu 內部。 這項分工可以維持共同主線，也能避免每篇都重複介紹相同的 device probe、resource lifecycle 與 protocol commands

### 第四篇以 Virtio 1.4 建立完整的 protocol 基礎

第四篇不會直接從 GPU commands 開始。 要知道 Linux `virtio_gpu` driver 與 device model 如何交換 requests，讀者必須先理解所有 virtio devices 共用的 device model、初始化流程、virtqueue 與 transport。 因此本文會以 [Virtio 1.4 specification](https://docs.oasis-open.org/virtio/virtio/v1.4/virtio-v1.4.html) 作為 protocol coverage 的基準，依序納入下列內容：

| Virtio 1.4 範圍 | 在第四篇回答的問題 |
| --- | --- |
| Chapter 2, Basic Facilities of a Virtio Device | Device status、feature bits、notifications、reset、device configuration、split／packed virtqueues、driver notifications、shared memory regions、object export、device groups、administration virtqueues 與 device parts 如何組成共通 device model |
| Chapter 3, General Initialization And Device Operation | Driver 如何從辨識裝置、協商 features、建立 queues 走到 `DRIVER_OK`，裝置運作期間如何回報 configuration change，最後如何 cleanup、reset 與 suspend |
| Chapter 4, Virtio Transport Options | PCI、MMIO 與 Channel I/O 如何將相同的 virtio device model 映射到不同 bus／transport。 三種 transport 都會說明，固定的 semu／RISC-V 主線則沿 virtio-mmio 原始程式碼展開 |
| Section 5.7, GPU Device | Device ID、controlq／cursorq、feature bits、device configuration、initialization、2D／3D operations 與 VGA compatibility 如何把共通 virtio model 具體化成 virtio-gpu |

這四個範圍中的每個 subsection 都要進入 coverage ledger。 每一筆會記錄該 subsection 定義的 object 或 requirement、它要解決的問題、固定組態是否使用，以及對應的 Linux／semu／QEMU 實作位置。 固定組態沒有使用的 optional facility 仍會交代其角色與未進入主線的原因，不能因為沒有對應 callgraph 就從文章省略

Specification 的章節順序只用來檢查內容是否完整，不會直接成為正文目錄。 正文仍會沿固定案例的執行順序前進：transport 先讓 Linux 找到 device，driver 再更新 status、協商 features 與建立 virtqueues，最後才透過 queues 交換 virtio-gpu requests

每個主要概念都要先說明當下的需求，再依序解釋 driver 使用的 object、device 看見的 wire layout、雙方如何改變 ownership／state，以及對應的 Linux 與 semu／QEMU 原始程式碼。 沒有進入固定主線的 optional clauses 則放進相鄰支線，說明它們會替換或擴充主線中的哪個步驟

Specification 提供的是 driver 與 device 之間必須遵循的 protocol contract，不能單獨解釋一項 graphics operation 最後如何在 host 執行。 例如 `VIRTIO_GPU_CMD_SUBMIT_3D` 會攜帶 renderer-specific command stream，但 Virtio specification 不會定義 VirGL command payload 內的 opcodes、state objects 與 drawing semantics。 因此第四篇會在 specification boundary 之後繼續沿既有材料展開：

1. Mesa VirGL encoder 如何產生 command stream
2. Linux `virtio_gpu` driver 如何將 payload 放進 `SUBMIT_3D` 並送入 virtqueue
3. semu／QEMU device model 如何處理 virtio-gpu command 與 renderer context／resource identity
4. virglrenderer 如何解碼 VirGL payload、管理 renderer objects，再呼叫 host OpenGL
5. Host completion 如何經 virglrenderer、device model、used buffer 與 interrupt 回到 guest fence

第四篇會沿用目前 2D 與 3D 放在同一個 device／resource model 中比較的架構。 共通 virtio 層先建立 transport 與 request lifecycle，virtio-gpu 層再分別展開 Display 使用的 2D／scanout commands，以及 Rendering 使用的 VirGL 3D commands。 Vulkan／Venus 等其他 renderer protocol 若出現在 Virtio 1.4 的 capability 或 context 定義中，本篇會說明其 protocol 位置，完整 command semantics 則留給對應的 Mesa／Vulkan 專篇

## 共用的二維閱讀座標

### 水平位置表示工作責任

所有系列總圖與 owner-specific 圖都使用相同的水平配置：

```text
Rendering                    Handoff                    Display
```

- 左側放置產生或轉換 graphics work 的節點，例如 API frontend、shader compiler、State Tracker、driver submission 與 compositor rendering
- 中央只放兩條責任之間的交接，例如 swap、Present、`wl_surface.commit`、WSI present、buffer sharing 與 fence transfer
- 右側放置視窗或 surface 狀態、composition output、KMS state、scanout 與 display publication

中央區域不是第三條工作主線。 它只標示 Rendering 產生的 image 如何成為 Display 可以安排與發布的內容

### 垂直位置只表示時間順序

圖中的時間由上往下前進。 垂直位置不再表示 owner、software layer 或文章篇次

- 具有先後關係的節點放在不同高度，並用箭頭標出 dependency
- 可以同時前進的工作可以放在相同高度，即使它們屬於不同 owner
- 相同高度表示兩項工作沒有被圖中的 dependency 強制排序，不承諾它們會在完全相同的 wall-clock 時間開始或結束
- 同一個 owner 可以在不同高度重複出現，例如 Xorg 先準備 X Screen，之後再處理 Present，最後再發出 KMS update
- Display 工作也可以在後面的時間點觸發新的 Rendering，例如 Xorg glamor 或 Wayland compositor 把多個 application images 合成 output image

箭頭是判斷實際順序的主要依據。 節點高度用來協助讀者看出大致階段與可並行的工作，不取代同步與 completion 的明確說明

### 顏色與文字共同表示 owner

Owner 由固定顏色表示，但每個節點仍要直接寫出 owner。 顏色只能協助快速掃描，不能成為唯一辨識方式

| Owner 類別 | 建議顏色 | 節點標籤範例 |
| --- | --- | --- |
| Application／toolkit | `#4B5563` | `[Application] glxgears`、`[GTK] GSK renderer` |
| Mesa | `#D97706` | `[Mesa] State Tracker` |
| Window system／compositor | `#0891B2` | `[Xorg] Present copy`、`[Wayland compositor] composition` |
| Linux DRM／KMS | `#2563EB` | `[Linux DRM] EXECBUFFER`、`[KMS] atomic commit` |
| virtio-gpu／host renderer | `#7C3AED` | `[virtio-gpu] SUBMIT_3D`、`[virglrenderer] decode` |
| Device／display backend | `#059669` | `[GPU] execute`、`[SDL2] publish VM window` |
| Project control plane | `#DB2777` | `[DDFW] layout policy`、`[twm] window policy` |

X11 window manager、DDFW 與其他 policy controller 使用對應 owner 顏色的虛線節點與虛線箭頭。 它們會改變 placement、lifecycle 或 layout state，但不承載主要 pixel 或 command data path

## 系列總圖

系列會先建立一張共用的總圖。 每篇文章開頭都重用同一張圖，再提高目前 owner 的對比，降低其他 owner 的飽和度。 節點位置、箭頭與文字不會因文章不同而改變，避免讀者每篇都重新學一套架構

總圖依下列時間階段由上往下排列：

1. 系統準備 graphics device、window system 與顯示輸出
2. Application 建立 graphics context、surface 或 Window，並取得可以寫入的 image
3. Mesa 或其他 graphics implementation 產生 rendering commands
4. Device、host renderer 或 software renderer 執行 commands，更新 application image
5. Swap、Present、Wayland commit 或 Vulkan WSI 將 image 與同步資訊交給 window system／compositor
6. Window system／compositor 依位置與可見範圍產生 composition work。 這個階段會回到 Rendering 左欄，但 owner 可能是 Xorg、Wayland compositor 或另一個 renderer
7. Composition output image 進入 KMS framebuffer、plane、CRTC 與 output state
8. Kernel driver、virtual device 或 display backend 發布更新，使用者看見新畫面

同一階段可以存在多個 owner。 例如 application rendering 已提交到 host renderer 時，Xorg 也可以開始處理 Present request。 這兩項工作會出現在接近的高度，再用 fence 或 completion arrow 表示真正需要等待的位置

總圖只建立跨 owner 的整體模型。 各 owner 內的 struct、callback、ioctl dispatch 與 branch 留在對應文章的局部圖與 callgraph

## 文章的切分方式

### 核心 owner 文章

核心系列維持六篇，但每篇都會明確標出該 owner 對 Rendering、交接與 Display 的責任

| 文章 | Rendering 主線 | 中央交接 | Display 主線與停止點 |
| --- | --- | --- | --- |
| Mesa／OpenGL | GLX／EGL setup、OpenGL frontend、shader compiler、State Tracker、Gallium 與 driver | drawable image、DRI、dma-buf、swap 與 present call | 說明 Mesa 如何把 image 與同步資訊交給 X11／Wayland，停在 window-system protocol 與 DRM UAPI |
| Linux DRM／KMS | render node、ioctl、GEM／TTM、dma-buf、scheduler、fence 與 syncobj | BO、framebuffer、reservation 與 fence | framebuffer、plane、CRTC、encoder、connector、atomic commit、vblank 與 driver callback |
| X11／Xorg | X11 drawing requests、Pixmap、pixman／glamor 與 Xorg 自己的 composition rendering | GLX、DRI3、Present、Window／Pixmap pair 與 Damage | X Screen、Window tree、screen Pixmap、composition、output update，停在 DRM UAPI |
| virtio 1.4／virtio-gpu | Virtio 共通 device model 與 transport、context、3D resource、EXECBUFFER、`SUBMIT_3D`、VirGL payload 與 virglrenderer | virtqueue request、resource ID、fence、host resource | display information、scanout、cursor、`RESOURCE_FLUSH` 與 host display backend |
| Wayland／compositor | Client buffer consumer、compositor renderer 與 composition | `wl_surface` attach／damage／commit、linux-dmabuf 與 explicit sync | surface state、scene graph、output image 與 DRM backend handoff |
| Mesa／Vulkan | Vulkan runtime、SPIR-V／NIR、driver、command buffer 與 queue submission | WSI surface、swapchain、acquire／present 與 semaphore | 說明 WSI 如何把 image 交給 native window system，停在 X11／Wayland 公開介面 |

文章仍以 owner 內部的模組或生命週期建立 H2。 每個 H2 的開頭會先用局部圖標出該單元位於 Rendering、交接或 Display 的哪個位置。 當兩項工作在同一個單元內都有完整流程時，再分成對應的 H3，或沿時間順序寫成跨越交接帶的 H3。 不需要為了形式建立沒有實質內容的同名章節。 例如 shader compiler 只需要展開 Rendering，GLX／EGL、DRI3、WSI、glamor、KMS 與 virtio-gpu 則會同時碰到兩欄

### 專案文章

專案文章使用同一張系列總圖，但會新增 project-specific 節點與 boundary

#### Unified HMI／RVGPU／DDFW

Unified HMI 會獨立成篇，說明專案如何橫跨多個主要 owner：

- virtio-loopback 與 RVGPU 在原生 Linux 建立一個可由 `virtio_gpu` driver 使用的虛擬 graphics device
- Application 與 Mesa 沿 virtio-gpu Rendering path 產生 3D commands
- `rvgpu-proxy` 與 `rvgpu-renderer` 將 commands 或 display results 經網路送到另一個裝置
- `rvgpu-wlproxy` 擔任 Wayland server／compositor-facing component，將 Wayland client 連到 RVGPU path
- DDFW 的 UCL 管理 application lifecycle，ULA 管理跨顯示器 layout

DDFW 會以虛線 control-plane overlay 表示。 Pixel、buffer 與 command data path 仍沿 RVGPU 與 Wayland 元件前進，不會畫成經過 DDFW 傳輸

### 建議篇次

核心六篇沿用既有編號，Unified HMI 專案文章新增在後面：

1. Mesa／OpenGL
2. Linux DRM／KMS
3. X11／Xorg／GLX／DRI3／Present
4. Virtio 1.4／virtio-gpu 2D／3D
5. Wayland／compositor／linux-dmabuf
6. Mesa／Vulkan／WSI／Venus
7. Unified HMI／RVGPU／DDFW

篇次只表示寫作與發布順序。 每篇開頭仍要用共用總圖建立足以單獨閱讀的上下文

## 每篇文章的內部結構

每篇文章依下列節奏前進：

1. 從使用者或 application 正在完成的動作開始，指出目前需要該 owner 解決的問題
2. 在共用總圖中提高目前 owner 的對比，標出這篇從哪個公開輸入開始，以及在哪個公開輸出停止
3. 用一張 owner-specific 圖展開該 owner 內的 Rendering、交接與 Display 節點
4. 按照時間順序解釋 object 建立、state 更新、work submission、同步與 completion
5. 以 source-backed callgraph 驗證本篇 owner 內的重要 control flow
6. 在 owner boundary 說明交出的 object、handle、request、同步資訊與 completion，再接到下一篇負責的介面

Owner-specific 圖只展開本篇 owner。 外部元件以輸入或輸出節點表示，不在同一張局部圖中繼續畫出其內部結構

## 交接帶需要固定回答的問題

Rendering 與 Display 每次會合時，都要回答下列問題：

1. Rendering 產生的是哪一份 image、buffer 或 command result
2. 哪個 object 保存 identity 與 metadata，哪個 object 引用真正的 pixel storage
3. Producer 以哪個 fd、handle、protocol object 或 request 把結果交給 consumer
4. Format、modifier、stride、offset、size 與 damage 等 layout metadata 如何傳遞
5. Consumer 何時可以讀取或重用 buffer，completion 由哪個 fence、event、reply 或 callback 表示
6. 交接後由誰持有 object reference，何時釋放

這些問題會套用到 DRI3／Present、Wayland buffer commit、Vulkan WSI、dma-buf、KMS framebuffer 與 virtio-gpu resource handoff。 各文章只展開自己負責的實作

## 圖片系統

### 圖片分成四類

1. 系列總圖
   - 同時呈現 Rendering、交接與 Display
   - 垂直位置表示時間
   - owner 顏色與標籤表示元件歸屬
2. Owner-specific 局部圖
   - 從總圖裁出或重畫該 owner 內部流程
   - 只保留相鄰 owner 的公開輸入與輸出
3. Object／storage／synchronization 圖
   - 用來區分 metadata object、storage、handle namespace 與 fence ownership
   - 例如 Window／Pixmap／dma-buf、`pipe_resource`／GEM BO／KMS framebuffer、application image／output image
4. Source callgraph
   - 保持現有 Markdown `callgraph` fence
   - 保存檔案、行號、symbol、branch 與實際 handoff
   - 不因新增 SVG 而改成只有方塊與箭頭的摘要圖

### SVG 交付方式

Agent 只需要交付 SVG，不要求建立或維護 Excalidraw 原始檔。 使用者後續若需要細部調整，可以自行以慣用工具重畫或修改

每張新 SVG 必須符合下列條件：

- 使用可縮放的 `viewBox`，不寫死只適合單一螢幕的尺寸
- 文字保持為 `<text>`，不轉成 path，方便後續修改
- 使用標準字型 fallback，不內嵌外部 web font
- 不嵌入 base64 raster image，除非圖片本身就是 screenshot
- 每個主要 node group 使用穩定的 `id`，方便手動選取與後續小改
- 線條終點要真正連到 node 邊界，不能穿過文字或停在空白處
- Owner 除了顏色，也要寫在 node label 中
- 技術名詞與 object 名稱使用英文 true name。 較長的中文說明放在 Markdown 圖說，不塞進 SVG
- 圖例說明實線、虛線、點線、owner 顏色與時間方向
- 最小字級、對比與色盲可辨識度要在實際文章寬度下檢查

### 線條語意

- 實線箭頭表示主要 command、image、buffer 或 state handoff
- 點線箭頭表示 fence、event、reply 或 asynchronous completion
- 虛線箭頭表示 policy 與 control-plane influence
- 沒有 dependency 的同高度節點不連箭頭，表示它們可以同時前進
- 跨越中央交接帶的箭頭必須標出傳遞的 object 或 request

### 第一批圖片清單

| ID | 圖片 | 回答的問題 | 主要使用位置 |
| --- | --- | --- | --- |
| `G00` | Rendering／Display 全系列時間圖 | 一張 image 如何沿 virtio-gpu 案例跨 owner 產生、交接、合成與發布 | 系列 PLAN 與每篇開頭 |
| `M01` | Mesa／OpenGL owner slice | OpenGL work 如何變成 application image，Mesa 如何交出 drawable buffer | Mesa／OpenGL |
| `D01` | DRM rendering 與 KMS display | render submission、BO、fence 與 atomic display 如何在 kernel 交會 | DRM／KMS |
| `X01` | X11 Window、Pixmap 與 screen storage | X11 metadata、application image 與 desktop image 如何區分 | X11／Xorg |
| `W01` | Wayland surface commit 與 composition | Client buffer 如何進入 compositor，再成為 output image | Wayland／compositor |
| `V01` | Virtio 共通 device lifecycle | Status、feature negotiation、queue setup、operation、reset 與 suspend 如何沿時間前進 | virtio-gpu |
| `V02` | Virtio transport 對照 | PCI、MMIO 與 Channel I/O 如何承載相同的 device model，固定 semu 主線位於哪一條 transport | virtio-gpu |
| `V03` | Virtqueue request lifecycle | Descriptor ownership、notification、device consumption、used buffer、interrupt 與 completion 如何循環 | virtio-gpu |
| `V04` | virtio-gpu Rendering／Display | 3D context／resource／submission 與 scanout／flush 如何共享 device | virtio-gpu |
| `V05` | Virtio-gpu／VirGL protocol boundary | `SUBMIT_3D` 外層 header、opaque payload、VirGL decode 與 host renderer 如何接續 | virtio-gpu |
| `VK01` | Vulkan WSI 交接 | Swapchain image 如何從 Rendering 交給 native window system | Mesa／Vulkan |
| `P01` | Unified HMI 資料路徑與 control plane | RVGPU、Wayland 與 DDFW 各自負責哪一段 | Unified HMI |

第一批只建立能顯著改善跨層理解的圖片。 Struct layout、單一函式或已能由短 callgraph 說清楚的內容不另畫 SVG

## 圖片清冊

實作前要為既有與新增圖片建立清冊。 每一筆至少保存：

- 圖片 ID 與檔名
- 它要回答的問題
- 使用文章與 heading
- 涉及的 owner
- Rendering、交接、Display 或 control-plane 範圍
- 圖中主要 objects、buffers、handles 與 fences
- 技術主張所依據的本機 source、commit 或既有已驗證段落
- 既有圖片、新繪、重畫、合併或淘汰狀態
- SVG 路徑與文章引用路徑
- 技術複核與文字複核狀態

Mesa 文章現有的 `glx-object-stage-*`、`glx-action-stage-*`、`glx-lifecycle-stage-*`、`kms-pipeline-boundary.png`、`xorg-display-setup-boundary.png`、`xorg-x11-mesa-buffer-objects.png` 與 `virtio-gpu-2d-3d-result.svg` 都要先列入清冊。 新圖只有在回答不同問題，或能合併多張重複圖時才新增

## 既有內容的搬移與去重複規則

### 搬移清冊

每個要移動、縮短或拆分的 H2／H3／H4 都先建立一筆清冊，記錄：

- 原 heading 與目前位置
- 原段落回答的問題
- 主要 owner
- 位於 Rendering、交接或 Display 的哪一側
- 原有程式碼、callgraph、圖片、來源連結與技術結論
- 新文章與新 heading
- 新位置需要先介紹的名詞
- 原位置最後保留的公開 boundary 說明
- 哪一處是完整定義的唯一位置
- 搬移、複核與刪除重複內容的狀態

目標文章尚未提供同等資訊以前，原段落不會從 Mesa 文章刪除。 搬移完成後，會先逐項比較 prose、source fences、callgraph nodes、URLs、圖片與結論，確認覆蓋範圍相同，再把原位置縮成 owner boundary

### 去重複原則

- 同一篇文章中，一個 object 或流程只能有一個完整定義位置
- Big Picture 可以先用一至兩句建立角色與輸入／輸出，owner-specific 章節再完整展開
- 後文回到相同 object 時，直接從前面建立的狀態繼續，不重新介紹整套背景
- 同一段流程若同時屬於 Rendering 與 Display，保留一份按時間前進的正文，再從兩條 lane 的角度整理圖與小結
- 跨篇重複只保留單獨閱讀需要的最低 overview，程式碼與內部 lifecycle 由 owner 文章保存
- 任何刪除都要能在搬移清冊中找到新的完整位置

### Mesa 文章的保留與調整順序

1. 凍結目前已 review 的 Big Picture 與固定組態，記錄 heading、圖片、callgraph、連結與內容 hash
2. 建立 Mesa 全文的 owner／lane／evidence 清冊，不移動正文
3. 把共用總圖放進 Big Picture，沿用目前 `glxgears` 與 semu VirGL 3D 主線
4. 在 Mesa owner 內重新整理 GLX／EGL、frontend、State Tracker、Gallium、driver、loader 與 libgbm 的 Rendering／交接責任
5. Xorg、DRM／KMS 與 virtio-gpu 文章尚未完成以前，保留 Mesa 文章現有的外部 owner source trace
6. 對應 owner 文章完成資訊對照並確認內容等價後，再逐節縮短 Mesa 文章的外部內部細節，只留下公開介面與下一篇所需的承上啟下

這個順序能保留已經雕琢過的敘事，同時避免採用新架構後，同一個定義在新舊章節各出現一次

## 驗證方式

### 設計與 PLAN

- 系列總 PLAN 與七篇文章 PLAN 都要列出 Rendering、交接與 Display 的責任
- 第四篇的 Virtio 1.4 coverage ledger 必須逐項涵蓋 Chapters 2、3、4 與 Section 5.7，不可只列出固定組態實際走過的 clauses
- 第四篇必須明確標出 Virtio specification boundary，並在其後追蹤 VirGL payload、virglrenderer 與 host renderer，不能把 `SUBMIT_3D` 當成 3D 路徑的終點
- 每篇文章要明確標示輸入 owner、輸出 owner 與停止點
- 每個 project-specific 元件都要先放回總圖，再展開專案內部
- H2／H3 搬移清冊不可有未指定新位置的條目
- 圖片清冊不可有未指定用途或未經技術複核的正式圖片

### 圖片

- SVG 必須能由 XML parser 正常解析
- 所有文章引用的 SVG 路徑都必須存在
- SVG 不可包含意外的 raster embed、缺字或超出 `viewBox` 的內容
- Owner 顏色、文字標籤、線型與時間方向符合共用圖例
- 同一高度的並行節點沒有被多餘箭頭強制排出不存在的順序
- 每條跨 owner 箭頭都標出 object、request、handle 或 completion
- 技術複核要對照本機固定 checkout，不以圖面看起來合理代替 source reading

### 文章

- 每個章節先交代上一階段得到的結果、目前缺少的條件與接下來要追的 owner
- 新名詞先由需求引出，再出現在 heading、圖、callgraph 或程式碼片段
- Rendering、Display 與 control plane 不混成同一種箭頭或責任
- Application image、composition output image 與 scanout image 的 storage identity 說明一致
- 同步說明區分 submission、execution completion、buffer release、present completion 與 display publication
- Markdown linter、heading／fence balance、image link、絕對路徑與重複 heading 檢查全部完成

## 後續實作邊界

這份設計通過 review 後，下一步會建立一份詳細實作計畫。 計畫會先修改系列 PLAN 與各篇 owner matrix，再建立搬移清冊與圖片清冊。 第一批 SVG 會由 agent 依本規格產生，使用者後續可以自行調整圖面。 Mesa 正文只會在清冊、圖稿與目標章節位置都確認後分批修改
