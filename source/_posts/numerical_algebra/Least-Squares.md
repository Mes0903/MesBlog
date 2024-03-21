---
title: Least Squares
date: 2021/11/6
mathjax: true
abstract: 數值線代的上課筆記，講的 Least Squares，老實說我已經忘光了
tags: numerical_algebra
categories:
- numerical_algebra
---

# 8.1 Least Squares

## 最小絕對偏差法 Least absolute deviation

假設現在給你這些點

![](https://i.imgur.com/ZDahVkF.png)
(圖源：[wiki](https://upload.wikimedia.org/wikipedia/commons/8/84/%E6%95%A3%E7%82%B9%E5%9B%BE.jpg) )

我們沒辦法用一條直線來通過這些全部的點，但我們可以像這樣找到誤差最小的直線：

![](https://i.imgur.com/WDxmaJq.png) 
(圖源：[wiki](https://upload.wikimedia.org/wikipedia/commons/d/d2/%E6%9C%80%E5%B0%8F%E4%BA%8C%E4%B9%98%E6%B3%95%E6%8B%9F%E5%90%88.jpg) )


這條直線可以幫助我們預測資料的方向。

假設 $a_1x_i + a_0$ 是這條直線上的第 i 個值，$y_i$ 是第 i 個給定的 y 值(原本的 y 值)，我們期望誤差最小，所以我們想要找到 $a_0$、$a_1$ 最小化這個式子：

$E_\infty(a_0, a_1) = max_{1 \leq i \leq 10}\{|\ y_i - (a_1x_i + a_0)\ |\}$

這個方法稱作 minimax approach，我們還可以換個方法，找絕對偏差的最小值：

$E_1(a_0, a_1) = \Sigma_{i=1}^{10} |y_i - (a_1x_i + a_0)|$

那我們要找最小值，也就是說我們要找到 $a_0$、$a_1$ 符合下面這兩條式子：

![](https://i.imgur.com/C6AokGt.png)

這個方法叫做最小絕對偏差法(least absolute deviation)，但問題是這兩條有絕對值，微分的處理很麻煩，所以下一個方法就出來了

## 最小平方法 Least Square

剛剛是因為絕對值微分很麻煩，所以這邊就把誤差平方：

$E_2(a_0, a_1) = \Sigma_{i=1}^{10} [\ y_i - (a_1x_i + a_0)\ ]^2$

這樣的話就解決了微分的問題，這樣一來不但微分好算，而且還是 convex 可以找到最佳解

## 正規方程式 Normal Equations

我們繼續找最小值，對上方的 $E_2$ 做偏微：

![](https://i.imgur.com/aS27YMV.png)

然後我們可以推出(用克拉瑪)：

![](https://i.imgur.com/XG1Xe5A.png)

這兩個等式就叫 normal equation。

## Polynomial Least Squares

然而妳拿到的資料很有可能不是一個用 $ax + b$ 就能表達的資料分布，像是這樣：

![](https://i.imgur.com/4Isx4Fm.png)

藍線明顯比紅線更好的講述了這個資料的分布，要做出這種藍線，我們就需要用更高次方的多項式來表達他，這時就需要用 Polynomial Least Squares 了

我們假設

$P_n(x) = a_nx^n + a_{n-1}x^{n-1} +\ ...\ + a_1x + a_0$，defree n < m - 1

那我們要找到 $a_0, a_1, ..., a_n$ 來最小化 E：

![](https://i.imgur.com/1tBidMn.png)

那一樣對他偏微：

![](https://i.imgur.com/owQsQNU.png)

那我們就可以推出這樣：

![](https://i.imgur.com/uETQ5Ty.png)

## 用矩陣表示

我們的目的是找到一條線 $y = a_1x + a_0$，或一個曲線，可以很好的表示資料 $\{(x_i, y_i)\}_{i=1}^m$ 的走向，後面可能會用 b 來代表 $a_0$，畢竟比較習慣用 b 來寫。

寫成矩陣會像這樣：

![](https://i.imgur.com/vHO2wgC.png)

但通常 $b \notin C(A)$，所以我們改成去找能讓 residual $E(\vec x) = ||\vec b - A\vec x||_2$ 最小化的 $\vec x$。 假設 $A \in \mathbb{R}^{m\times n}, b \in \mathbb{R}^{m+1}$，其中 $m>n$ (under determine)，

那麼 $\vec x$ 最小化 $E(\vec x) = ||\vec b - A\vec x||_2$ iff $\vec x$ 是 $A^TA\vec x = A^T\vec b$ 的解

證明：

![](https://i.imgur.com/Ofu7SJF.jpg)

這裡的 $\vec y$ 是 $\mathbb{R}^{n \times 1}$ 裡的隨便一個向量，$A$ 作用上去就會變 $C(A)$ 裡面的一個向量，所以和 $b - A\vec x$ 內積就會等於 0，因為垂直。

註：$A\vec x$ 解出來的所有結果會在一個固定的區域中，這個區域就叫作 column space $C(A)$，顧名思義就是每個 column 的線性組合 $\vec a_0 + \vec x_1 \vec a_1 + \vec x_2 \vec a_2 +\ ...\ + \vec x_m \vec a_m$，一維的話就是一條線，二維的話就是一個平面

那這個東西解起來就會像這樣：

![](https://i.imgur.com/gCHq6Ft.png)

因為我們拿到的資料通常都不會在平面 $C(A)$ 上，也就是剛剛說的通常 $\vec b \notin C(A)$，尤其是在妳資料點很多的時候 A 就會很長一坨，像上面就有 m 個資料點，所以 A 就是個 $m\times 2$ 的矩陣，如果 m 遠遠大於 2，那 $A\vec x = \vec b$ 基本上都沒有解，所以我們才會在這邊用這個方法找到誤差最小的解。

### 多維的 normal equation

多維代表不只有 $a_0$、$a_1$，還有其他的 $a_2$、$a_3$ 等等，所以你的 $A$ 的 column 數就會增加，以 $y = a_2x^2 + a_1x + a_0$ 來說就會長這樣：

![](https://i.imgur.com/EYbfOlm.png)

那麼 $\vec x = (A^TA)^{-1}A^T \vec b$ 大家應該就會求了。


## 自然對數相關

有時候資料的表示式可能是 $y = be^{ax}$ 這類的形式，那麼我們可以這樣寫：

![](https://i.imgur.com/UfblFub.png)

基本上跟前面講的一樣

