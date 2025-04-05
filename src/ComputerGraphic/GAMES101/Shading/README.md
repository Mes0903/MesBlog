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

:::info  
由於 Blinn-Phong 是個經驗模型，所以你可以看見有很多東西都被簡化了。 假設一個模型中間有個凹進去的點，那照理說該部分應該會暗一些，但在 Blinn-Phong 的角度就不是如此，由於環境光是個常數，在 Blinn-Phong 中凹進去的部分並不會變暗

再來 Blinn-Phong 也沒有考慮物體到觀察點的距離造成的能量損失，一般來說看一個較遠的物體應該要會比較暗，但在這裡就沒有這種現象

要更精確地描述這些現象，要到後面講 Radiometry 的時候才會解釋了
::: 

## 著色頻率（Shading Frequencies）

考慮完了一個最基礎的著色模型，接下來我們要來看著色點要怎麼取，這被稱為著色頻率（Shading Frequencies），看個例子：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/shading_frequency.png?raw=true">

</div>

這三個球擁有完全的幾何形狀，也就是說他們的幾何表示在空間中是一模一樣的，由相同的三角形組成。 但你可以很清楚的看到這三個球的顏色不一樣，從色塊的邊界你就可以發現問題，這就是著色頻率

著色頻率考慮我們要將著色應用在哪個部分，最左邊的球我們將著色應用到了一整個四邊形面上，每個面有一個固定的法向量，我們取一個面上的點求出其著色結果後，暴力的認為整個平面都是相同的顏色，也就是一個平面只做一次著色，你可以看見結果並不怎麼好

中間的球考慮了平面的四個頂點，算出每個頂點對應的法向量，接著進行著色，面中間的顏色透過內差法補上，得到的就是該結果，你可以看到結果好了不少

最右邊的球則將著色考慮到了每個像素上，也就與我們最一開始的想法一樣，你可以看見結果非常好，接下來我們來就來做一下正規的定義

### Shade each triangle (flat shading)

flat shading 對應到最左邊的球，將三角形的法向量求出來，這能透過將三角形的兩邊做外積求得。 接著我們根據使用的著色模型，算出一個著色的結果，而對於三角形的內部則沒有著色的變化，因此一個三角形只需要做一次著色：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/flat_shading.png?raw=true">

</div>

### Shade each vertex (Gouraud shading)

第二種方式對應到中間的球，叫做 Gouraud shading，對三角形上的頂點求出法向量，怎麼求我們等等再說，求出法向量後三個頂點各做一次著色，接著用內差將三角形內的顏色補上：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/gouraud_shading.png?raw=true">

</div>

結果比第一種好，但你可以看到當三角形稍微大一點的時候，例如圖中右邊棕色的球，高光可能會消失

### Shade each pixel (Phong shading)

第三種對應到最右邊的球，叫做 Phong shading，對每一個像素進行一次著色，就可以得到一個相對較好的結果

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/phong_shading.png?raw=true">

</div>

這邊要注意 Phong Shading 與 Blinn-Phong Model 是兩個不同的東西，Phong Shading 指的是著色頻率，Blinn-Phong Model 是著色模型，只是剛好都是由同一個人發明所以名字一樣而已

### 三者比較

實際上要用哪種方法要取決於具體的模型，Flat Shadding 並不一定會比較差，看個比較圖：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/frequency_compare.png?raw=true">

</div>

上圖中用的幾何模型都是一樣的，但 row 與 row 之間的三角形數會上升，中間的 row 比第一個 row 用了更多的三角形，也就是說幾何模型本身的面數變多，更光滑了。 你可以看見在幾何足夠複雜的情況下，我們其實可以用相對簡單的著色頻率，結果其實不會差太多

另外，這些方法的成本需要同時考慮模型的面數與像素的數量，並不是說 Phong Shading 開銷就一定比較大。 當你的模型太過複雜，複雜到其面數已經超過了像素的數量，那自然用 Phong Shading 會比較快

### 頂點法向量

#### Per-Vertex Normal Vectors

我們還留了一個問題，三角形頂點的法向量怎麼算。 假設在一個理想的情況下，我們知道模型要表達的是一顆球，但實作上是用三角形來表示

那我們就可以知道三角形的頂點其實對應到球上的某一個點，此時就可以利用球的位置算出三角形頂點的法向量，這很好算，只要算出球心連向三角形頂點的向量即可，見圖中右上角部分：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/per_vertex_normal_vector.png?raw=true">

</div>

但平常不可能有這麼好的事情，因此人們發明了一種方法，取任何一個頂點，他肯定會和很多個不同的三角形有所關連，例如上圖右下角的部分中，四個三角形共用了一個頂點，那我們就認為這個頂點的法向量是相鄰四個面的法向量的平均

注意在這邊我們不做 normalize，我們希望如果一個三角形越大，那它貢獻的部分就越多，也就是說我們的平均是加權平均，權重以三角形的面積來計算，實務上這的確會帶來更好的結果

這就是我們如何去定義一個以頂點為考量的法向量

#### Per-Pixel Normal Vectors

另一個是以像素為考量點，定義一個逐像素的法向量。 假設我們已經知道三角形頂點的法向量了，那我們可以透過重心座標來做內差，以得到對應的法向量：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/per_pixel_normal_vector.png?raw=true">

</div>

上圖中我們的前提是知道左右兩個頂點的法向量，之後透過內差算出中間這些法向量。 這邊注意就要做 normalize 了，要保證他們長度都是相同的

至於要怎麼做重心座標的內差，我們後面再提

## Texture Mapping（紋理映射）

接下來我們要開始講紋理映射，它想做的事很簡單，看看下圖：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture_mapping.png?raw=true">

</div>

上圖中有兩個檯燈在照亮一個地板和一顆球，對於球，他的著色我們會寫，如果我們認為檯燈的光是一個點光源，這樣無非就是兩個把點光源的貢獻加起來就可以了，但是在那顆球上面，我們可以看到不同的位置有不同的顏色，像是球的一半是藍的一半是黃的，中間還有一個紅色的星星圖案

這些點的區別在於，雖然他們共用了同一個著色模型，但是不同點的漫反射係數不一樣（假設是 Blinn-Phong）。 看另一個例子，以地板來說也是如此，燈光在照地板，在地板上的任何一個點其實都有自己的漫反射係數，這個係數會反映在木頭的紋路上

也就是說我們希望有一個方法，能夠定義對於一個物體，其上面的不同位置的屬性，這就是引入紋理映射的一個基本思路，不過並不是說我們需要完全用它來定義漫反射係數，而是希望能定義不同點有不同屬性

要定義一個點的屬性，首先我們要理解點在哪，我們把屬性定義在物體表面上，那當然點就在物體表面上，但要如何描述物體表面呢? 我們要知道任何一個三維物體，它的表面其實都是二維的，像是地球儀與表面的地圖一樣：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture_mapping2.png?raw=true">

</div>

通過這種方式，我們就能將一張二維的圖與一個三維物體的表面建立一個對應關係，這張二維的圖就被我們稱為紋理。 因此你可以想見我們的目的是把這張二維的紋理想辦法蒙上一個三維物體的表面，過程中我們可以隨意拉伸，或是隨意的撕開紋理圖，這個過程就叫做紋理映射

看下面這個獨眼巨人的例子：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture2.png?raw=true">

</div>

左上圖是我們透過 Blinn-Phong 得到的結果，而中間就是套用了紋理的結果，右上角的是我們的紋理圖。 根據剛才的思路，我們需要想辦法找到一個關係讓三維物體上的每一個點都能對應到紋理圖中的某一個點

因為三維空間中最基本的東西是三角形，因此我們會以三角形為單位在看這個映射關係，你可以看到上圖左下角我們找了一個空間中的三角形，他的確對應到了右下角紋理圖中的一個三角形

至於這個映射關係要怎麼找，有兩種方法，第一種是靠建模的人手動做，在做出模型後，他們會將模型展開，手動貼到紋理圖中的不同位置，一聽工作量就很大，但仍然是個可行的人工方案

第二種是嘗試找到自動化的方法，給我們任何一個模型，我們希望將它展開成一個平面，而且三角形要盡可能的不扭曲，例如原本該三角形在三維空間中很小，我們不希望展開到平面後他突然變得超大。 這種方法是圖學中的一個重大研究方向，叫做參數化（Parameterization），在幾何的部分是一個非常厲害的研究

現在我們先假設已經找到了映射關係，此時三維空間的三角形理應都已經被映射到了二維的紋理圖上，我們是利用三維空間的座標來描述其三角形的，那相對地，對於紋理圖我們就也會需要一組座標系來描述它，讓我們能夠真正表示紋理圖上的點

紋理圖的座標系被稱為紋理座標，通常會用 $u$ 和 $v$ 來表示兩個軸：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture_coordinate.png?raw=true">

</div>

上圖是一個紋理座標視覺化的結果，$u$ 越大則紅色越多，$v$ 越大則綠色越多，因此不同顏色就代表了紋理圖上不同的點，而把紋理映射到三維模型後就是上圖左邊的結果

通常對於一張紋理圖來說，不管你的紋理是不是正方形的，我們都會認為 $u$ 和 $v$ 的範圍介於 0 到 1 之間，這是為了方便，也算是一個習慣

紋理可以應用在各種不同的物體表面，再看個例子：

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture3.png?raw=true">

如果我們把它所有點的紋理座標都顯示出來，那會長這樣：

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture4.png?raw=true">

你可以看見座標不斷地從 0 到 1 重複，就好像在貼磁磚一樣，如此一來便可以把整個物體給貼滿，這也告訴我們紋理圖上的點並不需要只被用一次，一個點可以映射到三維空間中的不同位置

上圖中在紋理左右重複的交界處我們可以看到有很明顯的一條交界線，然而在上上張圖內的石頭中我們卻沒有看到這樣的現象，因此如果紋理本身設計的好，那紋理自己在往各方位重複的時候就會無縫銜接，紋理的上下、左右側能接上，這就非常好

這樣的紋理在圖學中被稱為 Tiled Texture，要設計這種紋理是需要各種不同的演算法的，其中一種演算法比較常用的演算法叫 Wang Tiling，這邊就只簡單提一下，不再展開說了

## Graphic Pipeline

至此我們已經知道給一個幾何模型與著色模型，我們要怎麼得出渲染的結果了。 至此我們可以嘗試把學到目前為止的東西都合在一起，這被稱為 Graphic Pipeline，它描述的是從一個 3D 的場景到其真的變成一張 2D 的圖，到底經過了一系列怎麼樣的過程，每個組件就對應到我們前面的不同章節提到的概念：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/graphic_pipeline.png?raw=true">

</div>

所以我們這邊就來做個統整、複習。 我們的輸入都是一系列空間中的點，因此第一步要做投影，將 3D 的點變換到螢幕空間中：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/MVP.png?raw=true">

</div>

接著透過光柵化，對像素進行取樣，我們可以將其離散為不同的像素，在 OpenGL 內被稱為 fragment，在這步我們要算出不同像素的顏色是什麼：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/rasterization.png?raw=true">

</div>

在計算的過程中我們產生了一系列的像素，此時還需要 Z-Buffer 來判斷其可不可見，當然這步我們可以把它也算到光柵化中，只是這裡分得比較細：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/z_buffer.png?raw=true">

</div>

然後便是著色：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/shading.png?raw=true">

</div>

在上圖中你會發現一件事，這裡頂點和像素的著色會同時發生，這是因為考慮到有不同的著色頻率，現代的 GPU 會讓這兩個部分變成可編成的，因此你可以在這兩個步驟中寫自己的 code 來控制要用什麼著色頻率。 整個實時渲染就是針對這兩個部分再做文章，通過程式碼來決定頂點和像素要怎麼處理，這些程式碼我們稱其為 shader，負責控制頂點和像素要如何著色

最後還有一部分是紋理（Texture），讓我們可以顯示貼圖：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/ComputerGraphic/GAMES101/Shading/image/texture.png?raw=true">

</div>

這就是我們處理從三維場景到最後渲染出一張二維的圖的一個基本操作，而除了前面提到的 Vertex Processing 與 Fragment Processing，其餘的操作都是已經在 GPU 硬體內被寫好的

### Shader Program

Shader 本質上是一些能在 GPU 硬體上執行的語言，以 OpenGL 為例，他是一個圖學的 API，你可以用它來寫 shader，對於每個頂點或是像素，他都會執行一次你的 Shader code，因此你不需要有個 for loop，在寫 Shader 時只需要專注在一個頂點或像素即可

專注於頂點的 Shader 被稱為頂點著色器（Vertex Shader），而專注於像素的 Shader 被稱為像素著色器（Fragment Shader），Fragment 也會有人翻成片段，但基本上是同一個意思

現在來看幾個具體的例子，對於 Fragment Shader，他的輸出是一個像素最後的顏色，底下是一個簡單的範例，他用的是 OpenGL 的著色語言，稱為 GLSL：

```glsl
uniform sampler2D myTexture;    // program parameter
uniform vec3 lightDir;    // program parameter
varying vec2 uv;    // per fragment value (interp. by rasterizer)
varying vec3 norm;    // per fragment value (interp. by rasterizer)
void diffuseShader()
{
  vec3 kd;
  kd = texture2d(myTexture, uv); // material color from texture
  kd *= clamp(dot(–lightDir, norm), 0.0, 1.0); // Lambertian shading model
  gl_FragColor = vec4(kd, 1.0); // output fragment color
} 
```

這裡說的是有兩個全域變數 `myTexture` 與 `lightDir`，分別代表紋理和光照方向，也就是說我們認為每一個像素都有一個固定的光照方向。 而 `norm` 代表法向量，它是利用差值算出來的，也就是說對於目標三角形，它可能三個頂點各有不同的法向量，但我們不管，到了這個像素裡面 OpenGL 會自動幫我們差值出它的法向量

由於這份程式碼每個像素都會執行，因此不需要 for loop，每個像素都會執行 `diffuseShader` 這個函式，在當中由於我們假設光照是一個常數，因此只需要將其與法向量做內積，就可以得到 Blinn-Phong 中漫反射的部分。 算出來後再將他賦值給 `gl_FragColor`，表示一個像素的顏色

通過 Shader，我們就可以定義任何一個頂點或像素要怎麼操作了。 如果你實際去學一些圖學的 API，例如 OpenGL、DirectX 或 Vulkan，你會發現我們只需要指定場景中的東西要如何運動、選轉，相機要如何擺放即可，實際的矩陣並不用我們自己寫，這就是因為這些 API 內部都幫我們做好了
