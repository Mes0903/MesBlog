---
title: Error Bounds
date: 2021/10/16
mathjax: true
abstract: 數值線代的上課筆記，講的 Error Bounds，老實說我已經忘光了
tags: numerical_algebra
categories:
- numerical_algebra
---

# 7.4 Error Bounds

電腦裡面要表達一個數字，像是 $\pi$，是無法沒有誤差表達出來的。在電腦裡面我們能表達的數大概在 $10^{-300}$ ~ $10^{300}$ 之間。

所以你也可以知道如果我們要電腦幫我們解 Ax = b，那麼必定會有誤差，因為電腦除了整數之外，大部分的數字是幾乎不可能沒有誤差的。

### Def

我們要解 Ax = b 這個線性系統的時候，假設我們透過迭代方法找到一個解 $\bar x$，那我們當然期望 $\bar x$ 和 x 之間的距離要非常接近。

如果現在只有 $\bar x$，很明顯 $A\bar x$ 不會等於 b，那我們就定義一個東西叫 residual vector $\vec r = \vec b - A\bar x$，residual 就是殘餘的意思。

那我們就期待如果 $||\vec r|| = ||\vec b - A\bar x||$ 很小，那麼 $||\vec x - \bar x||$ 就會很小。 你可能會想說這很理所當然，但針對某些線性系統這會不成立，也就是說雖然 $||\vec r||$ 很小，但 $||\vec x - \bar x||$ 卻很大，因為電腦並沒有辦法準確的表達所有數字。

我們看個例子，這邊我們解一個 Ax = b：

![](https://i.imgur.com/mxgmOsw.png)

A 矩陣的第一個 row 和第二個 row 只有一點點差異，如果我們用手去解你會發現他是可逆的，然後解會是 $\vec x = (1,1)^T$。

但如果我們今天用某種迭代方法算出一個解長 $\bar x = (3,0)^T$，你把它丟進去算 residual vector，然後算 infinity norm，他會是 0.0002，但你去算 $||\vec x - \bar x||_\infty$ 卻會是 2。

那為什麼，原因完全出現在 A 矩陣裡面，我們接 Thm 7.27。

### Thm 7.27

我們假設 $\bar x$ 是一個 Ax = b 的逼近解且 A 是 nonsingular，那我們會發現 $||\vec x - \bar x|| \leq ||\vec r||\cdot||A^{-1}||$。

然後如果 $\vec x$ 不是 trivial 的解且 b 不是 0 向量，那我們可以導出這件事來(我全貼) ：

![](https://i.imgur.com/yJv6L1P.png)

我們先看一下上面的在說什麼，他的意思是逼近解跟真實解的絕對誤差會小於等於右邊那個東西，而下面那個則是逼近解與真實解的相對誤差會小於等於右邊那個式子。

所以一個是絕對誤差，一個是相對誤差。

套用到剛剛的例子，就會長這樣：

![](https://i.imgur.com/GLWQN6v.png)

也就是說雖然 $||\vec r||$ 很小，但 $||A||\cdot||A^{-1}||$ 很大的話仍然會爆掉：

![](https://i.imgur.com/zLIXeAO.png)

所以關鍵就是在 $||A||\cdot||A^{-1}||$

證明：

![](https://i.imgur.com/XlTNBU9.png)

### Def 7.28

$||A||\cdot||A^{-1}||$ 在線代裡面是個很重要的東西叫做條件數(condition number)，記做 K(A)

![](https://i.imgur.com/iVoC0Xl.png)

如果 K(A) 接近 1，我們就說這個系統是良置的，如果遠遠大於 1，就說這個系統是病態的。

舉個例子：

![](https://i.imgur.com/UgX1dGJ.png)

### Thm 7.29

接下來是另一個主題，就像一開始所說我們會有 rouding error，又稱 perturbation，也就是說我們實際上 Ax = b 丟進去電腦時會跑出個 $\delta$，像這樣：

![](https://i.imgur.com/sVaXKQX.png)

那我們把它就代回 Ax = b：

![](https://i.imgur.com/H3eXCUl.png)

這時我們就會發現電腦裡面算出來的 $\bar x$ 和我們實際上的 x 的相對誤差是上圖下面那樣，一樣取決於 K(A)

證明：

![](https://i.imgur.com/4odqRL6.png)