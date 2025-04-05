---
title: Games101：Shading（著色）
date: 2025-04-05
tag: 
  - computer-graphic
  - GAMES101
category: computer-graphic
---

# Games101：Shading（著色）

到目前為止，給一個模型，我們已經可以定義一個相機，通過 MVP 變換將其轉換到 NDC 中，再透過 viewport 將其變到二維的螢幕空間中了，接著我們也知道要如何利用取樣來將這個結果畫到螢幕上了：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/opening.png?raw=true">

</div>

這些操作所帶來的結果可能如下圖左邊部分：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/opening2.png?raw=true">

</div>

這看上去可能會有些視覺誤差，我們想要的應該是右邊的結果，雖然每個對應的立方體顏色相同，但不同面有不同的顏色會使他看起來更真實一些，這就是我們接下來要做的事 — 著色（Shading）

:::info  
原影片中這是個會動的，能更清楚的看出視覺誤差，但截 gif 太大了我就不截了  
:::

如果大家學過素描，假設要畫一個球，且有一個光源，光源達到球上的某一塊區域時會形成一個有高光的區域，然後背向光源面由於接受不到光就會比較暗，且會產生一個投影，影子內的顏色會比較暗。 另外如果是不同材質的球，那其與光線的交互作用肯定不同，因此表現出來的形式肯定也不同

這些工作在圖學中就是由著色來完成的，因此著色主要負責兩個部分 — 顏色與材質，完成這組著色工作的模型我們稱其為著色模型

## Blinn-Phong Reflectance Model

接下來我們就從最基礎的著色模型開始介紹，其名為 Blinn-Phong，它將光的表現分成了三個部分 — 高光（Specular highlights）、漫反射（Diffuse reflection）與環境光（Ambient lighting）：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/blinn_phong.png?raw=true">

</div>

在這張圖中，我們可以看到每個茶杯特別亮的部分，這杯稱為高光。 除了高光，我們還可以在茶杯的表面看到一些變化相對緩和的部分，像是茶杯的中間部分，被稱為漫反射。 而對於沒有直接被光源照到的部分，像是圖中茶杯的左下角，則被稱為環境光

如果你還記得以前上物理課提到的漫反射，就可以知道光線打到粗糙的牆面上會反射到四面八方去，而高光也可以用相同的原理來理解，只是這個表面不再是個粗糙表面，而是個光滑表面，此時光線會沿著所謂的鏡面反射方向去做反射，這就是所謂的高光。 同時由於光線會反射，因此總是會有一部分的光達到茶杯的左下角，之後再反射回人眼，從而就形成了環境光。 把這三部分組合起來，我們就可以做出一種材質，使其與杯子長的很像，讓我們覺得圖中的這三個物體是杯子

### shading point（著色點）

在講 Blinn-Phong 之前我們需要先定義一些相關的術語：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/shading_point.png?raw=true">

</div>

我們所看到的點被稱為著色點（shading point），他是我們主要的著色目標。 著色點會位於一個物體的表面，由於是一個點，我們認為著色點的所在範圍永遠是一個平面，此時就可以定義出平面的法向量（`n`）了。 然後我們還需要兩個向量，第一個是觀測方向（`v`），也就是相機與著色點形成的向量；第二個是光照方向（`I`），為光源與著色點形成的向量。 這些向量我們通常喜歡由著色點出發，因此如圖中所示三個向量都從著色點出發，另外因為是拿來表示方向的，所以它們都為單位向量

另外著色點還會有一些其他與物體表面相關的屬性，像是有多光滑，例如一個陶瓷的物體上了釉之後會變得比較亮，但如果他是一個石膏那就不一樣；再來如果他是一塊木頭，那在光打到它的時候你可能可以看到一些紋路。 它們反射光的方法基本上是一樣的，因此需要其他的屬性來輔助形成不同的效果

最後提一下區域性（locality），在考慮任何一個著色點的情況下，我們頂多就看光照與觀測範圍，並不會去關注其他物體，包括陰影。 也因此在著色時我們只考慮了光線的方向，並沒有考慮光線是否有被擋住，所以著色點會有明暗變化，但不會生成陰影，陰影要在後面的章節才會再補上：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/shading_point2.png?raw=true">

</div>

可以看到上圖中並沒有陰影，只有明暗變化（正常來說光源對面的地板應該要有陰影）

### Diffuse Reflection（漫反射）

剛剛提到了 Blinn-Phong 由三個部分組成，現在我們從最簡單的漫反射項開始。 當有一根光線達到物體表面的某個點時，這個光線會被均勻的反射到各個不同的方向上去，這就是漫反射

而在物體表面的面向與光照方向有一定夾角時，得到的明暗會有變化：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/lambert.png?raw=true">

</div>

上圖中有六根光線，我們假設光是離散的，每一根光線代表了固定的能量，此時我們發現，如果物體表面和光照方向垂直的話，其可以接收到所有的六根光線；如果有個夾角，像是中間轉了 60 度的情況，那就只能接收到三根光線，此時物體的表面理應就要變得暗一些

這與高中地科裡面提到地球有四季的原因是一樣的，並不是說夏天太陽比較近，而是夏天會被太陽直射，單位面積內收到的能量較多

因此我們可以得知物體表面的面向與光照方向，這兩個方向的夾角決定了物體的表面要多亮。 這邊有個定律叫 Lambert's consine law，延續前面的符號，我們用向量 $l$ 代表光照方向，用 $n$ 代表物體表面的法向量，Lambert's consine law 定義說接收到的能量與「光照方向和法向量夾角的余弦」成正比，而由於兩個向量都是單位向量，因此可以用內積來表示他們的余弦，透過這個定律我們就可以分析出一個著色點的漫反射項會接收到多少光（能量）

定義好了接收，但我們還沒定義這些能量是從哪裡來的，光肯定得先產生。 光本身是一種能量，假設光來自於一個光源，我們認為它是個點光源，無時無刻都會往四面八方輻射出相同的能量，因此這些能量會集中在一個球殼上：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/light_falloff.png?raw=true">

</div>

我們認為往各個方向出去的速率是一樣的，因此過了很長時間後能量仍然會集中在一個球殼上，但是由於球殼的半徑變大了，所以單位面積上的能量是會隨著時間變小的，我們定義半徑為 1 時光的強度（光強）為 $I$，透過能量守恆定律，我們可以得知若傳播到距離為 $r$ 的位置，則該點的光強為 $I/r^2$

因此我們得到了第二個關係 — 「著色點和光源的距離」與光強的關係

結合前面的 Lambert's consine law，我們就可以算出漫反射這項共有多少能量了，也就能將物體的明暗給算出來了：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/diffusion.png?raw=true">

</div>

$I/r^2$ 是著色點的光強，而 $n \cdot l$ 為兩向量的夾角，表示可以收到多少比例的能量，其中 $\max$ 的用意是避免內積的結果為負數，因為當其結果為負數時代表光線是從物體表面下方來的，這沒有物理意義，這邊只考慮反射，沒考慮折射

而對於 $k_d$ 項，我們要來思考一下為什麼一個著色點會有顏色，這只有一個可能性，著色點吸收了一部分的能量，接著將不吸收的部分反射了出去，反射出去的光的波長就是我們見到的顏色。 如果不同的著色點有不同的吸收率，那自然就會產生不同的顏色


因此我們利用一個係數 $k_d$ 來描述這個吸收率，如果為值是 1，則代表完全不吸收能量，因此最亮，如果是 0 則相反吸收所有能量，因此會是黑的，如此一來就表現了明暗，或說著色點本身吸收了多少能量：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/kd.png?raw=true">

</div>

如果把吸收了多少能量這件事用一個向量來表示，我們就可以把它弄成一個有三個元素的向量，代表 RGB，分別都介於 0 到 1 之間，進而定義出顏色

最後再提一件事，漫反射的能量會被均勻的反射到各個不同的方向上去，這代表不管我們從哪個方向觀測它，得到的結果應該要是一模一樣的。 從上方的公式來看也是如此，我們考慮的是光照方向和法向量之間的夾角，完全沒有考慮 $v$ 向量的事，這正是因為漫反射往四面八方反射的能量都是相同的

### Specular（高光）

高光是在物體的表面比較光滑時，反射方向非常接近鏡面反射的結果。 那如果給我們入射方向，我們自然能算出他的出射方向：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/specular.png?raw=true">

</div>

上圖中將出射方向記為 $R$，可見我們只有在觀察方向接近鏡面反射方向的時候，才能夠看見高光，其他時候都看不到。 換句話說 $v$ 和 $R$ 要足夠接近，而我們可以利用半程向量（Halfway Vector）來描述這件事情：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/half_vector.png?raw=true">

</div>

半程向量 $h$ 為入射方向 $l$ 與觀測方向 $v$ 的角平分線向量，要求角平分線很簡單，只要兩個向量加起來，根據平行四邊形法則我們知道加出來的方向一定會沿著中間的方向，接著我們再做 normalize，就可以得到半程向量了

當 $v$ 和 $R$ 接近的時候，其實就代表 $h$ 和 $n$ 接近，因此在計算的時候我們就可以不去求 $v$ 和 $R$ 的夾角，而是求 $h$ 與 $n$ 的夾角

:::info  
你可以不使用 $n$ 與 $h$ 來判斷，而是直接使用 $R$ 與 $v$ 來判斷兩向量是否接近，這個模型則被稱為 Phong Model。 Blinn-Phong 在這裡使用半程向量是一種優化，因為半程向量比較好算，但反射方向 $R$ 不好算出來，計算量會多很多  
:::

而與前面漫反射當中提到的相同，要看兩向量是否足夠接近，用內積即可，如果足夠接近，那結果就接近 1，如果離比較遠就接近 0，同樣地我們會 $max$，不考慮反方向來的向量。 另外，公式中的 $k_s$ 被稱為鏡面反射係數，由於大家通常認為高光是白色的，因此通常會設為一個較近 1 的值。 通過上圖中的式子就可以得出有多少能量到達了著色點

前面漫反射的公式中我們還考慮到了有多少能量被著色點吸收了，也就是當中的 $I/r^2$ 項，但在高光這邊沒有，這是因為 Blinn-Phong 是經驗模型，把這部分簡化掉了，這邊關注的主要是我們能否看見高光，而沒有太關心他的亮度

再來，你可能會發現在高光的公式中，cosine 處多了一個指數 $P$，這是為了將能看見高光的範圍縮小，我們看一下它數值上的表現：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/reflection_lobe.png?raw=true">

</div>

你可以發現在 $P$ 為 1 的情況下，假設角度為 45 度，那其實 $v$ 與 $R$ 就已經離的挺遠的了，但余弦取出來的值還是偏大，用這個值去生成高光的話我們會看到一個超級大的高光，但我們希望高光只集中在一個很小的區域，這代表只要 $v$ 與 $R$ 稍微離的遠一點，$v$ 就不應該被算在高光的範圍裡了，因此透過加上指數 $P$，我們可以讓這個範圍變得更嚴格，隨著次方的上升，當 $P$ 為 64 的時候，你可以看到大概在 20 度的地方基本上我們就看不到高光了

這個 $P$ 通常我們會設成一個在 100 到 200 之間的數字，此時大概 5 度左右就看不到高光了。 我們可以將 $P$ 的效果視覺化出來看一下：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/specular2.png?raw=true">

</div>

你可以看到 $P$ 越大，能看見高光的角度越少，因此可以控制高光的大小；而當 $k_s$ 越接近 1，鏡面反射的效果就越明顯，高光就越亮（越白）

### Ambient（環境光）

我們還剩最後一項環境光，之前茶杯的例子中我們說一些沒被光源直接照射的著色點不可能完全是暗的，因為光線會彈射很多次，分散到四面八方去，因此會彈到茶杯背面的那些著色點上，從而讓那些點有有顏色

可想而知這是一個很複雜的計算，為了簡化計算，Blinn-Phong 做了一個大膽的假測，我們認為任何一個點接收到的環境光的強度永遠都是個定值，寫作 $I_A$：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/ambient.png?raw=true">

</div>

從這個公式你可以發現環境光不講究從哪個地方進來，與 $l$ 無關；再來環境光與觀測的方向也無關，因此與 $v$ 無關；最後他與法向量也無關，因此跟 $n$ 和 $h$ 都無關。 也因此這個公式符合我們剛剛環境光是個定值的假設

環境光的工作在於保證沒有地方完全是黑的，讓你看到的物體有一個常數的顏色，再以公式中的 $k_a$ 用來控制亮度，兩者結合就可以得到環境光

### Blinn-Phong Model

現在我們將三者加起來就可以得到完整的 Blinn-Phong Model 了：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/blinn_phong2.png?raw=true">

</div>

上圖將三個不同的部分視覺化出來了，你可以看見環境光是個常數的顏色，而漫反射項則攜帶了主要的顏色資訊，高光攜帶了鏡面反射的資訊，三者加起來就可以得到上圖最右邊的結果，有點像塑膠玩具，這也是 Blinn-Phong 的特點之一，詳細的原因我們在後面的章節會再回來解釋

## 