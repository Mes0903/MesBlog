---
title: The Linux graphics stack in a nutshell 翻譯 & 筆記
date: 2025-09-03
tag: 
- Linux
- computer-graphic
category: 
- Linux
- computer-graphic
---

# The Linux graphics stack in a nutshell 翻譯 & 筆記

原文連結：

- [The Linux graphics stack in a nutshell, part 1](https://lwn.net/Articles/955376)
- [The Linux graphics stack in a nutshell, part 2](https://lwn.net/Articles/955708)

## The Linux graphics stack in a nutshell, part 1

當 Linux 圖形開發者談到「現代的 Linux 圖形系統」時，通常指的是多個獨立軟體元件的組合。 它包含了由核心管理的顯示資源、用於合成的 Wayland、加速的 3D 算繪（而非 X11）。 這個系列的兩篇文章會快速地帶你走訪圖形程式碼，看看它是如何把應用程式的資料轉成畫素資料並顯示到螢幕上的。 本文這一篇將聚焦於應用程式算繪、Mesa 的內部運作，以及所需的核心功能

### Application rendering

圖形輸出從應用程式開始，應用程式會處理並保存要視覺化的格式化資料。 用於視覺化的常見資料結構是「[場景圖（scene graph）](https://en.wikipedia.org/wiki/Scene_graph)」：它是一棵樹，其中的每個節點要麼存放三維空間中的模型，要麼存放模型的屬性

模型節點包含要呈現的資料，例如遊戲的場景，或科學模擬的元素； 屬性節點則設定模型的朝向或位置，每個屬性節點都會影響其下方的節點。 為了把場景圖算繪成螢幕上的影像，應用程式會自上而下、由左到右走訪這棵樹，依序設定或清除屬性，並相應地算繪 3D 模型

在下方的範例場景圖裡，算繪從根節點開始，根節點會準備算繪器（renderer）並設定輸出位置。 應用程式先走左側分支，在座標 (0, 0) 算繪「Rectangle 1」，並套用上存放於「Texture 1」裡面的表面圖樣。 接著應用程式回到根節點，改走右側分支，進入名為「Transform」的屬性節點

應用程式以 4×4 矩陣描述各種變換（例如定位或縮放），演算法會在算繪過程中套用這些矩陣。 此例中，該變換節點將其所有子節點等比例縮放為 0.5 倍，因此算繪「Rectangle 2」與「Rectangle 3」時，大小會呈現為原來的一半，位置分別調整為 (10, 10) 與 (15, 15)。 這兩個矩形使用了不同的紋理：分別為 2 與 3

![](image/scenegraph.png)

為了簡化算繪並利用硬體加速，大多數應用程式會使用標準 API，例如 [OpenGL](https://opengl.org/) 或 [Vulkan](https://vulkan.org/)。 不同 API 的細節各有差異，但它們都提供介面來管理圖形記憶體、把資料寫入其中，並算繪已保存的資訊。 最終會得到一張影像，應用程式可以直接顯示，或再把它當成輸入做後續處理

所有圖形資料都放在「緩衝物件」裡，每個緩衝物件都是一段圖形記憶體，並附有控制代碼或 ID。 例如，3D 模型會存放在對應的「[頂點緩衝物件（vertex-buffer object）](https://en.wikipedia.org/wiki/Vertex_buffer_object)」中，紋理會存放在「[紋理緩衝物件（texture-buffer object）](https://www.khronos.org/opengl/wiki/Texture)」中，物件的[表面法線](https://en.wikipedia.org/wiki/Normal_(geometry))也會放在緩衝物件裡，而輸出的影像本身也[存放在一個緩衝物件裡](https://www.khronos.org/opengl/wiki/Framebuffer_Object)。 因此，圖形算繪在很大程度上其實是記憶體管理的工作

::: tip  
在 OpenGL 名稱裡，VBO（Vertex Buffer Object）是常見的頂點資料容器，它只是「緩衝物件」在作為頂點來源時的慣稱。 紋理一般對應到「紋理物件（texture object）」，另有一種稱為 Buffer Texture / Texture Buffer Object（TBO）的機制，讓紋理直接使用一個緩衝物件作為儲存體、供著色器索引大量資料，因此原文內提到的「紋理緩衝物件」可視為泛指「與紋理相關的（含 TBO 在內的）物件/緩衝」

至於「輸出影像」在實作上可能是附著於 framebuffer 的紋理或 renderbuffer，但要點是一切最終都落在由句柄/控制代碼管理的 GPU 記憶體區塊上，這也是為何圖形程式設計很大一部分在處理資源與記憶體生命週期  
:::

只要圖形[著色器（shader）](https://en.wikipedia.org/wiki/Shader)能處理，應用程式就可以用任何格式提供輸入資料。 著色器是一種程式，其中包含把輸入資料轉換成輸出影像的指令，它由應用程式提供，並由顯示卡來執行

實際的的著色器程式可能會實作複雜的 multi-pass 演算法，但在此範例中只會介紹必要的部分。 著色器中最常見的兩種操作，大概是頂點變換與紋理查詢。 我們可以把頂點想成多邊形的角。 用 [OpenGL Shading Language（GLSL）](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language)撰寫時，頂點變換看起來像這樣：

```c
uniform mat4 Matrix; // same for all of a rectangles's vertices
in vec4 inVertexCoord; // contains a different vertex coordinate on each invocation

gl_Position = Matrix * inVertexCoord;
```

變數 `inVertexCoord` 是來自應用程式場景圖的輸入座標。 變數 `gl_Position` 則是在應用程式輸出緩衝中的座標。 簡單來說，前者屬於顯示中的場景座標系，後者屬於應用程式視窗內的座標系。 `Matrix` 是描述這兩個座標系之間的變換的 4×4 矩陣

這段著色器操作會對場景圖中的每個頂點執行一次。 在前述的矩形場景圖例子裡，每個矩形的每一個頂點都至少會被 `inVertexCoord` 包含一次。 而矩陣 `Matrix` 會包含該頂點的變換，例如如何把它移到正確的位置，或依照變換節點指定的 0.5 比例進行縮放

當頂點被變換到輸出座標系之後，著色器程式會計算被覆蓋的「片段（fragment）」的各種數值，這是圖形領域的術語，指的是一個帶有 Z 軸深度值與其他資訊的輸出像素。 每個片段都需要顏色，在 GLSL 中，著色器的 `texture()` 函式會像這樣從紋理取回顏色：

```c
uniform sampler2D Tex; // the texture object of the current rectangle
in vec2 vsTexCoord; // interpolated texture coordinate for the fragment

Color = texture(Tex, vsTexCoord);
```

這裡 `Tex` 代表一個紋理緩衝（texture buffer）。 `vsTexCoord` 的值是紋理座標，也就是在紋理中要讀取的位置。 透`texture()` 會回傳一個顏色值，把它指定給 `Color`，就能把一個帶顏色的像素寫入輸出緩衝

為了將像素資料填滿輸出緩衝，這段著色器程式碼會對每個片段各執行一次。 正被繪製的模型會指定要使用的紋理緩衝，而紋理座標則由 OpenGL 的內部計算提供。 以上述的場景圖為例，應用程式會對每個矩形各自呼叫這段程式碼，並使用該矩形所對應的紋理緩衝

把這些著色器指令套用到整棵場景圖之後，就能生成應用程式的完整輸出影像了
