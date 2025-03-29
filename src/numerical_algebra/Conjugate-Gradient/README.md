---
title: Conjugate Gradient Method
date: 2021-10-31
tag: numerical-algebra
category: numerical-algebra
order: 6
---

# Conjugate Gradient Method

#### Conjugate Gradient Method

這邊我們一樣考慮解 $A\vec x = \vec b$，前面講的是 Gradient Method，那這節要講的是 Conjugate Gradient Method，效率一般來說會更好，而且好很多

$\alpha$ 要選來 minimize $\Phi(\vec x^{(k)})$，因為我們希望它越小越好，前面的 Gradient Method 裡面 $\vec p^{(k-1)}$ 是用 gradient 來做的，但這邊我們不用這個方法

我們先看 $\alpha$，先不管 $\vec p^{(k-1)}$，所以假設 $\vec p^{(k-1)}$ 已知：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/1.png?raw=true">

</div><br>

基本上推導過程差不多，所以重點就是 $\vec p^{(k-1)}$ 要怎麼找

#### A-orthogonal

在開始找之前我們先給個定義，假設 A 是個 $\mathbb{R}^{n\times n}$ 的矩陣，我們說有一個 nonzero vector 的 set $\{\vec v^{(1)}, \vec v^{(2)},\ ...\ , \vec v^{(n)}\}$，如果這個集合滿足 $<\vec v^{(i)}, A\vec v^{(j)}> = 0\  \ if\ \ i \ne j$ 的話，我們就說這個集合是一個 A-orthogonal 的 set

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/2.png?raw=true">

</div><br>

那我們說這個集合如果是 A-orthogonal 而且 A 矩陣是對稱正定的話，那麼這個集合必定會線性獨立，證明：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/3.png?raw=true">

</div><br>

代表這個集合是 $\mathbb{R}^n$ 的一組基底

#### Thm 7.32

給定一個集合 A-orthogonal 的集合 $\{\vec v^{(1)}, \vec v^{(2)},\ ...\ , \vec v^{(n)}\}$，$A$ 是對稱正定矩陣

那當我們要解 $A\vec x = \vec b$ 時我們要用這個式子：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/4.png?raw=true">

</div><br>

那妳可以看見 $\vec v$ 只有 n 項，也就代表最多只會迭代 n 次，也就是說 $\vec x^{(n)}$ 就是我們要的 $\vec x$

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/5.png?raw=true">

</div><br>

證明：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/6.png?raw=true">

</div><br>

所以現在問題就變成 $\vec v$ 要怎麼找了

#### Thm 7.33

residual vector $\vec r^{(k)}$, k = 1, 2, ..., n，滿足 <$\vec r^{(k)}, \vec v^{(j)}$>$= 0$, j = 1, 2, ..., k

也就是說 $\vec r^{(1)}$ 和 $\vec v^{(1)}$ 垂直，$\vec r^{(2)}$ 和 $\vec v^{(1)}$ 還有 $\vec v^{(2)}$ 垂直，$\vec r^{(n)}$ 和全部的 $\vec v^{(j)}$ 垂直

那證明我們就用數學歸納法：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/7.png?raw=true">

</div><br>

#### 找 A-orthogonal 的集合

假設執行到第 k 步的時候 $\vec x^{(1)}, \vec x^{(2)}, ... , \vec x^{(k-1)}$ 且 $\vec v^{(1)}, \vec v^{(2)}, ... , \vec v^{(k-1)}$ 都已經知道了，那下一次的 $\vec v^{(k)} = \vec r^{(k)} = \vec r^{(k-1)} + \beta_{k-1}\ \vec v^{(k-1)}$

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/8.png?raw=true">

</div><br>

因為我們要造的是 A-orthogonal 的集合，所以我們希望找到的 $\beta_{k-1}$ 能讓 $\vec v^k$ 和上一次的 $\vec v^{(k-1)}$ 垂直，那就把寫下來整理一下：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/9.png?raw=true">

</div><br>

然後把前面算出來的 $\alpha$ 抄下來推一下：

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/10.png?raw=true">

</div><br>

#### 算 Conjugate gradient

<div style="display: flex; flex-direction: column; align-items: center;">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/numerical_algebra/Conjugate-Gradient/image/11.png?raw=true">

</div><br>
