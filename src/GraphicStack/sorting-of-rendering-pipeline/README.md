---
title: 論文筆記：A Sorting Classification of Parallel Rendering
date: 2026-09-25
tag: 
- graphic-stack
- papers
category: 
- graphic-stack
- papers
---

# 論文筆記：A Sorting Classification of Parallel Rendering

- 論文連結：https://ieeexplore.ieee.org/document/291528

這篇是 Molnar 等人在 1994 提出的論文，他是一個針對 parallel rendering architecture 的分類方法。 它提出了三種形式的 rendering pipeline 實作：

- sort-first
- sort-middle
- sort-last

可以幫助我們來對 rendering architecture 做初步的分析。 本文只會簡單紀錄一下他的概念，成本的計算本身很簡單，加上實作方法不同其實成本也不一樣，所以直接看論文知道一下怎麼算就好

## Background

我們可以簡單將 rendering pipeline 分為兩個部分：

- 幾何處理（geometry processing）：包括座標轉換（transformation）、裁切（clipping）、光照計算（lighting）等
- 光柵化（rasterization）：包括掃描轉換（scan conversion）、著色（shading）以及可見性判定（visibility determination）等

整體流程大致如下：

```callgraph
CPU-side commands / GPU resources
    ├─ vertex buffer
    ├─ index buffer
    ├─ textures / constants
    ├─ draw commands
    │
    ↓
[CP: Command Processor]
    ├─ 接收 CPU 提交的 commands
    ├─ 解讀 draw / pipeline state
    ├─ 啟動後續 graphics workload
    │
    ↓
Geometry processing
    │
    ├─ [GE: Geometry Engine] Input assembly / geometry front-end
    │   ├─ 取得 vertex / index data
    │   ├─ 解讀 primitive topology
    │   │   ├─ triangle
    │   │   ├─ line
    │   │   └─ point
    │   ├─ 保存 primitive connectivity
    │   │   └─ 知道哪些 vertices 屬於同一個 primitive
    │   └─ vertex reuse / vertex cache
    │       └─ 避免 shared vertex 重複執行 Vertex Shader
    │
    ├─ [SPI: Shader Processor Input]
    │   ├─ 收集 vertex work items
    │   ├─ 組成 wave
    │   ├─ 選擇可用 WGP / CU
    │   └─ 配置 registers / program counter 等執行狀態
    │
    ├─ [WGP / CU] Vertex Shader
    │   ├─ 執行 programmer 提供的 VS
    │   ├─ object-space → clip-space
    │   │   └─ 通常包含 Model / View / Projection transformation
    │   ├─ 輸出 clip-space position
    │   └─ 產生 per-vertex varyings
    │       ├─ UV
    │       ├─ color
    │       ├─ normal
    │       └─ world/model-space position 等
    │
    ├─ [GE + WGP / CU] Tessellation（optional）
    │   ├─ [WGP / CU] Tessellation Control / Hull Shader
    │   │   └─ 決定 tessellation factors
    │   ├─ [GE: fixed-function tessellator]
    │   │   └─ 細分 patch domain
    │   └─ [WGP / CU] Tessellation Evaluation / Domain Shader
    │       └─ 計算細分後 vertices 的 position / attributes
    │
    ├─ [GE + WGP / CU] Geometry Shader（optional）
    │   ├─ primitive-level programmable processing
    │   └─ 可修改 / 丟棄 / 產生 primitives
    │
    ├─ [SX: Shader Export]
    │   ├─ 接收 geometry shader stages 產生的 vertex outputs
    │   └─ 將 position / parameters 送往後續 primitive path
    │
    ├─ [PA: Primitive Assembler]
    │   ├─ 取得 Geometry Engine 保存的 connectivity
    │   ├─ 將 transformed vertices 重組成 primitives
    │   ├─ primitive-level processing
    │   ├─ view-frustum / guard-band related processing
    │   └─ face orientation / back-face culling
    │
    ├─ [PA_CL: Clipper]
    │   ├─ clip-volume clipping
    │   ├─ near / far clipping
    │   ├─ user clip-plane processing
    │   └─ 必要時產生新的 clipped vertices / primitives
    │
    ├─ [PA_CL / VTE: Viewport Transform Engine]
    │   ├─ reciprocal / perspective divide
    │   │   └─ (x, y, z) ← (x/w, y/w, z/w)
    │   └─ viewport transform
    │       ├─ NDC X/Y → screen / window X/Y
    │       └─ NDC Z → viewport depth range
    ↓
Rasterization
    │
    ├─ Pixel rendering
    │   │
    │   ├─ [PA_SU: Primitive / Setup Unit] Rasterization setup
    │   │   ├─ primitive setup state
    │   │   ├─ vertex coordinate quantization / conventions
    │   │   ├─ pixel-center convention
    │   │   └─ 準備後續 scan conversion 所需狀態
    │   │
    │   ├─ [PA_SC / Scan Converter] Coarse rasterization
    │   │   ├─ 接收 screen-space primitive
    │   │   ├─ 使用 triangle screen-space bounds
    │   │   ├─ 以 coarse pixel blocks 搜尋候選區域
    │   │   └─ All the Pipelines 範例：4×4 pixel groups
    │   │
    │   ├─ [PA_SC / Scan Converter] Fine coverage determination
    │   │   ├─ 對候選區域測試 triangle edges
    │   │   ├─ 決定每個 pixel / sample 的 coverage
    │   │   ├─ 套用 rasterization coverage rules
    │   │   └─ 產生後續 interpolation 所需的
    │   │       barycentric / gradient information
    │   │
    │   ├─ [PA_SC / Scan Converter] Quad formation
    │   │   ├─ 將 pixels 組成 2×2 quads
    │   │   ├─ 保留 helper pixels / lanes
    │   │   └─ 支援 Pixel Shader derivatives
    │   │
    │   ├─ [SPI: Shader Processor Input]
    │   │   ├─ 接收 rasterizer 產生的 pixel quads
    │   │   ├─ 收集 pixel work items / waves
    │   │   ├─ 準備 Pixel Shader inputs
    │   │   └─ dispatch 到 WGP / CU
    │   │
    │   ├─ [LDS parameter path + WGP / CU V_INTERP]
    │   │   Attribute interpolation
    │   │   ├─ rasterizer 提供 barycentric coordinates I / J
    │   │   ├─ 取得 triangle vertex parameters
    │   │   ├─ perspective-correct interpolation
    │   │   └─ 產生 per-fragment varyings
    │   │       ├─ UV
    │   │       ├─ color
    │   │       ├─ normal
    │   │       └─ 其他 shader inputs
    │   │
    │   ├─ [WGP / CU] Pixel / Fragment Shader
    │   │   ├─ 執行 programmer 提供的 FS / PS
    │   │   ├─ material computation
    │   │   ├─ lighting computation
    │   │   └─ 產生 candidate color / shader outputs
    │   │
    │   ├─ [Texture Unit: TA / TD / TCP path] Texture sampling
    │   │   ├─ Pixel Shader 發出 texture / image instruction
    │   │   ├─ texture address calculation
    │   │   ├─ texture cache access
    │   │   ├─ filtering / sampling
    │   │   └─ 將 sampled value 回傳 WGP / CU
    │   │
    │   └─ [SX: Shader Export]
    │       └─ 將 Pixel Shader 的 color / depth 等輸出
    │           送往 Color / Depth Backend
    │
    ├─ Visibility / output operations
    │   │
    │   ├─ [DB: Depth Backend]
    │   │   ├─ depth test / Z comparison
    │   │   ├─ stencil test
    │   │   ├─ depth / stencil update
    │   │   └─ depth-related compression / backend operations
    │   │
    │   └─ [CB: Color Backend]
    │       ├─ color blending
    │       ├─ color write masks / render-target operations
    │       ├─ MSAA resolve 等 backend operations
    │       ├─ color compression
    │       └─ render-target write
    ↓
Framebuffer / Render Target
    ├─ Color buffer
    ├─ Depth buffer
    └─ Stencil buffer
```

:::tip

<details> <summary>上圖中的縮寫一覽</summary>

| 縮寫         | 全稱                                              | 意義                                                                                                                                              |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP**       | Command Processor                                 | GPU command front-end，接收並處理 CPU/driver 提交的 commands                                                                                 |
| **GE**       | Geometry Engine                                   | AMD GPU 圖形管線的 geometry front-end，負責處理 vertex ID、primitive topology/connectivity 與 vertex reuse |
| **SPI**      | Shader Processor Input                            | shader/workgroup dispatch front-end，負責將 work items 與 waves 分派給 shader execution hardware |
| **WGP**      | Workgroup Processor                               | RDNA 中由兩個 CU 組成的 shader 執行群組 |
| **CU**       | Compute Unit                                      | 執行 shader 的硬體單元，在 RDNA 中每兩個 CU 組成一個 WGP |
| **SIMD**     | Single Instruction, Multiple Data                 | 同一 instruction 同時作用於多個 lanes/work-items                                                                                             |
| **SX**       | Shader Export                                     | 接收 shader export，並將 vertex/pixel shader 的特殊輸出送往後續 graphics blocks |
| **PA**       | Primitive Assembler                               | 將 transformed vertices 重新組成 primitives，並處理 primitive-level graphics work |
| **PA_CL**    | PA Clipper block / register namespace             | PA 中與 clipping、viewport transform 等功能相關的 register/function namespace |
| **VTE**      | Viewport Transform Engine                         | 執行 viewport scale/offset 與 $1/w$ 處理 |
| **PA_SU**    | PA Setup Unit                                     | 負責 primitive setup，涵蓋 pixel-center convention、rounding 與 coordinate quantization |
| **SC**       | Scan Converter                                    | Scan Converter，執行 rasterization / coverage determination                                                             |
| **PA_SC**    | PA/Scan-Converter register namespace              | `PA_SC_*` 是 rasterization、edge rules、scissor 與 MSAA 等控制 registers 使用的 namespace/prefix |
| **VS**       | Vertex Shader                                     | Programmable per-vertex shader                                                                                                               |
| **PS**       | Pixel Shader                                      | Direct3D 中的 per-fragment/pixel programmable shader |
| **FS**       | Fragment Shader                                   | OpenGL/Vulkan 中的 per-fragment programmable shader，功能大致對應 Direct3D 的 PS |
| **TCS**      | Tessellation Control Shader                       | OpenGL/Vulkan 中負責設定 tessellation factors 等細分參數的 shader stage |
| **TES**      | Tessellation Evaluation Shader                    | 對 tessellation 產生的 domain coordinates 計算 vertex position/attributes                                                                    |
| **LDS**      | Local Data Share                                  | AMD GPU 的 on-chip shared memory，可供 workgroup 內的 work-items 共用，也可用於 pixel parameter interpolation |
| **VGPR**     | Vector General-Purpose Register                   | 每個 work-item/lane 的 vector register                                                                                                       |
| **SGPR**     | Scalar General-Purpose Register                   | wave-level scalar register                                                                                                                   |
| **V_INTERP** | Vector/parameter interpolation instruction family | AMD shader ISA 中執行 parameter interpolation 的 vector instruction family |
| **TA**       | Texture Addresser                                 | shader vector-memory path 的 address-processing unit，接收 vector memory instructions 與 write/atomic data，再合併成較少的 cache requests |
| **TD**       | Texture Data                                      | vector L1/data-return path，將資料送回 requesting SIMD/wave                                                                   |
| **TCP**      | Texture Cache per Pipe                            | shader vector-memory path 的 per-pipe cache，處理讀取、寫入與 atomic 等 vector memory operations |
| **CB**       | Color Backend                                     | color/render-target backend，例如 blend、color write、compression 等                                                                         |
| **DB**       | Depth Backend                                     | depth/stencil backend，例如 Z/stencil tests、depth storage 等                                                                                |
| **RB**       | Render Backend                                    | 處理繪圖管線最後階段的 depth/stencil 與 color 輸出操作 |
| **ROP**      | Raster Operations Processor / Pipeline            | 處理最後階段的 depth/stencil、blending 與 render-target operations |
| **NDC**      | Normalized Device Coordinates                     | Perspective divide 後的 normalized coordinate space                                                                                          |
| **MSAA**     | Multisample Anti-Aliasing                         | 一個 pixel 使用多個 coverage/depth samples 的 anti-aliasing 方法                                                                             |

</details>

:::

我們的目的是以平行化的方式來執行「幾何處理」和「光柵化」，而這基本上有兩種方式可以做：

- object parallelism：以物件（object、mesh、primitive 等）為單位來進行平行化
- pixel/image parallelism：以像素或螢幕的一個區域為單位來進行平行化

作為平行化的起點，假設我們有 N 個 processor，每個 processor 上面會跑一個 Renderer，那一開始我們可以先將三角形（primitive）平分給各個 Renderer，例如有 1000 個三角形與 4 個 Renderer，那一開始就是每個 Renderer 都各處理 250 個三角形。 接著，在不同的路徑中，我們會再依據不同的策略來在不同的時刻做一次「重新分配」，這個重新分配就叫做「sort」

為了做重新分配，他可能還會需要先對資料做一些預處理。 另外由於要把資料重新分配到各個 Renderer 上，所以就需要做一定程度的資料搬移，因此我們關注的重點在於：

- 資料在 pipeline 的哪個位置被重新分配
- 重新分配的是什麼資料
- 為了做重新分配而做的計算有多少成本
- 搬資料的成本

而根據重新分配的時機點的不同，可以將 rendering pipeline 分為三種類型：

- sort-first：在幾何處理期間進行重新分配
- sort-middle：在幾何處理與光柵化之間進行重新分配
- sort-last：在光柵化期間進行重新分配

但如前所述，這只是個概念，實作可能會做一些變形，因此不一定會很標準的屬於某一種

## Sort-first 與 Sort-middle

### Sort-first

對於 sort-first 來說，他會在「完成 geometry processing 之前」就做 sort，他採用的是 pixel parallelism，會以螢幕的一個區域為單位來進行平行化，假設我們有四個 Renderer，那就把螢幕切成四個區域，每個 Renderer 負責一個區域內的 primitive，接著各個 Renderer 就這樣一路做完幾何處理與光柵化：

```
+----------------+----------------+
|   Renderer 0   |   Renderer 1   |
|                |                |
+----------------+----------------+
|   Renderer 2   |   Renderer 3   |
|                |                |
+----------------+----------------+
```

這邊的問題在於，我們要在做完 geometry processing 之前就做重新分配，換句話說我們還沒有做 viewport transform，因此我們尚不知道各個頂點的 screen space 座標。 所以 sort-first 需要先想辦法提早算出各個頂點／三角形（看你在哪個階段做）之後會位於螢幕上的哪個區域

這個做法在論文裡面沒有特別去展開，但是有許多做法，例如你可以先為每個 primitive 弄個 bounding box，然後就只為 bounding box 做一次 MVP + viewport transform 就好，這樣就可以減少運算的次數，並得知每個 primitive 之後大概會位於 screen space 的哪個區域

因此整體流程會像這樣（數字是我隨便舉例來的）：

```callgraph
Raw primitives
  │
  │ - Renderer 0：算出手上的 250 個 primitive 之後大概位於 screen space 的哪個區域
  │ - Renderer 1：算出手上的 250 個 primitive 之後大概位於 screen space 的哪個區域
  │ - Renderer 2：算出手上的 250 個 primitive 之後大概位於 screen space 的哪個區域
  │ - Renderer 3：算出手上的 250 個 primitive 之後大概位於 screen space 的哪個區域
  ↓
做 sort-first 
  │ 
  │ 重新將這 1000 個 primitive 分配給四個 Renderer
  │
  │ - Renderer 0：拿到 400 個 primitive
  │ - Renderer 1：拿到 200 個 primitive
  │ - Renderer 2：拿到 50 個 primitive
  │ - Renderer 3：拿到 150 個 primitive
  ↓
Geometry processing
  │
  │ 每個 Renderer 各自完成手上拿到的 primitive 的 Geometry processing
  ↓
Rasterization
  │
  │ 每個 Renderer 各自完成手上拿到的 primitive 的 Rasterization
  │ 因此每個像素的 visibility 至此都做完了，接下來只要寫入 Framebuffer / Render Target 就好
  ↓
Framebuffer / Render Target
```

可以發現這樣的話每個 primitive 需要做兩次 MVP，但好處是在有 Tessellation 的情況下，一個大的 primitivie 會變成很多小 primitive，如果我們等到 viewport transform 做完（也就是 sort-middle 的做法），那在做 sort 時就會需要多搬很多 primitivie，例如我把一個 primitive 細分成 1000 個 primitive，那要搬的東西就會變 1000 倍，oversampling 的情境下同理

另外一個好處是 sort-first 的每個 renderer 都會擁有完整的 pipeline，不用做到一半把一些 intermediate screen-space data 交給別人

總結來說，sort-first 追求的是「在 primitive 的數量還沒有因為後續的 geometry processing 而膨脹之前，就把它送到正確的 screen-region renderer」

### Sort-middle

Sort-middle 的想法則是在做完 viewport transform 拿到 screen space 座標的時候來做 sort，這是個非常自然的時間點，因為此時你已經有了所有 primitive 的 screen space 座標，所以可以很簡單的以螢幕區域來將各個 primitive 分配到對應的 Renderer

::: tip
另外，通常幾何處理與光柵化本來就是由不同的處理器負責的，所以這也成為了一個通用且直接的切分點
:::

因此整體流程會像這樣：

```callgraph
Raw primitives
  │
  │ - Renderer 0：手上有 250 個 primitive 要處理
  │ - Renderer 1：手上有 250 個 primitive 要處理
  │ - Renderer 2：手上有 250 個 primitive 要處理
  │ - Renderer 3：手上有 250 個 primitive 要處理
  ↓
Geometry processing
  │
  │ 每個 Renderer 各自完成手上拿到的 primitive 的 Geometry processing
  ↓
做 sort-middle
  │
  │ 計算每個 primitive 落在哪些螢幕區域，並分配到對應的 Renderer 上：
  │
  │ - Renderer 0：拿到 400 個 primitive
  │ - Renderer 1：拿到 200 個 primitive
  │ - Renderer 2：拿到 50 個 primitive
  │ - Renderer 3：拿到 150 個 primitive
  ↓
Rasterization
  │
  │ 每個 Renderer 各自完成手上拿到的 primitive 的 Rasterization
  │ 因此每個像素的 visibility 至此都做完了，接下來只要寫入 Framebuffer / Render Target 就好
  ↓
Framebuffer / Render Target
```

因此他做的事和 sort-first 很像，主要差別在於

- Sort-first：先做 sort 再完成幾何處理
- Sort-middle：先完成幾何處理再做 sort

如前所述，sort-middle 不需要像 sort-first 那樣做一開始的預處理，會少掉這部分的計算。 但壞處就是當有 Tessellation 或 oversampling 時資料的搬移成本會變大

## Sort-last

Sort-last 跟前面兩個做法不一樣，他希望盡量把 sort 的時機點延後，但因為這樣的話就不會事先以螢幕區域來分配好工作，每個 Renderer 手上的 primitive 都可能處於螢幕的任何一個區域，所以成本會變相的集中在最後做 depth test 的時機點

假設一樣有 1000 個 primitive，一開始一樣任意分配：

- Renderer 0：primitive 0 ~ 249
- Renderer 1：primitive 250 ~ 499
- Renderer 2：primitive 500 ~ 749
- Renderer 3：primitive 750 ~ 999

接著每個 Renderer 都有一套完整的 rendering pipline，而且都可以算繪整個螢幕，所以同一個 screen pixel 可能會被不同 renderer 的 geometry 影響，例如 piexl $P$：

$$
\begin{aligned}
R_0&: \text{red}, &z=0.4\\
R_1&: \text{blue}, &z=0.2
\end{aligned}
$$

但由於兩個 renderer 各自都只知道自己的 geometry，所以最後我們必須要把同一個 pixel 的結過聚集起來，再做 visibility/compositing：：

```
R0: P(red, 0.4)  ─┐
                  ├→ compositor → min(0.4,0.2) = 0.2
R1: P(blue,0.2) ──┘
```

所以這裡該 pixel 的結果是藍色

整體流程為：

```callgraph
Raw primitives
  │
  │ - Renderer 0：250 primitives
  │ - Renderer 1：250 primitives
  │ - Renderer 2：250 primitives
  │ - Renderer 3：250 primitives
  ↓
Geometry processing
  │
  │ 每個 Renderer 各自完成自己的 geometry processing
  ↓
Rasterization / Pixel rendering
  │
  │ 每個 Renderer 都可以 render 整張 screen，
  │ 因此可能在相同 pixel 產生不同的 sample results
  ↓
做 sort-last
  │
  │ 將 pixel / sample results 依 screen position 重新分配並聚集
  ↓
Global visibility / compositing
  │
  │ 對來自不同 Renderer 的 results 做 depth comparison / compositing
  ↓
Framebuffer / Render Target
```

而在做 sort-last 的時候我們有兩種方式來送 pixel／sample 的資料，論文將這兩種方式稱為 SL-sparse 與 SL-full

SL-sparse 只會送有產生的 sample，假設 Renderer 0 只畫到：

```
+----------------------+
|                      |
|       XXXX           |
|       XXXX           |
|                      |
+----------------------+
```

那它只會傳這些有效的 samples：

```
XXXX
XXXX
```

沒產生 sample 的位置就不傳，因此資料量不會被 Renderer 的數量嚴重影響

SL-full 的話則是不管實際畫到了多少 pixels，每個 renderer 每次都會產生一張完整的 partial framebuffer，因此資料量會被 Renderer 的數量嚴重影響，每多一個 Renderer 就會多出整張 framebuffer 的資料，但好處是我們可以把資料大小、merge pattern 等格式固定下來，不像 SL-sparse 需要 variable-sized communication，因此很適合用 hardware 來做
