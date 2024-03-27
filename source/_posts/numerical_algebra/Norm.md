---
title: Norm
date: 2021/9/19
mathjax: true
description: 數值線代的上課筆記，講的 Norm，這我再怎麼說還是記得的
tags: numerical_algebra
categories:
- numerical_algebra
---

# 7-1：Norm

## 向量 Norm

### Def 7.1

我們現在隨便給一個向量，我們需要定義怎麼測量他的長度，這個就叫做 norm，中文叫做「範」。

假設我們現在給了向量 x, y，它們是 $R^n$ 底下的向量，那這個 norm 就是一個函數，他把我們的向量從 $R^n$ 送到 R。那一個 norm 需要滿足四個性質：

1. 除了零向量以外，它的 norm 一定大於 0
2. 零向量的 norm 為 0
3. 裡面乘上任意一個實數，那個實數可以加絕對值提出來
4. 三角不等式，兩個向量相加完取 norm 會小於等於兩個個別取 norm 相加。

![](https://i.imgur.com/TGGWi4X.png)

### Def 7.2

那常見的 norm 有三個，這邊我們給一個 $R^n$ 裡面的向量 x，那它裡面的元素就叫 $x_1$, $x_2$ ... $x_n$：

1. two norm
    
    把每一個元素掛絕對值後平方加起來，再開根號

2. p norm
    
    跟 two norm 很像，把每個元素掛絕對值後乘 p 次方加起來，再開 p 次方根
    
3. infinite norm

    把所有的元素掛絕對值後取最大的那個

![](https://i.imgur.com/QorcEVu.png)

### Def 7.5

另外，一個在 $R^n$ 裡面的向量 $x^{(k)}$ 的數列，k 從一到無窮大，我們說在下面這個條件下，這個數列在相對應的 norm 下收斂到一個 x 向量：

![](https://i.imgur.com/UCfRKeS.png)

不一定要 two norm，N 通常是跟 epilson 有關的函數

### Thm 7.3：柯西不等式

給兩個 $R^n$ 裡的向量 x, y，我們可以寫下這個關係式：

![](https://i.imgur.com/37gs5s9.png)

## Matrix norm

我們也可以對矩陣取 norm，這邊我們給一個在 $R^{n\times n}$ 下的矩陣 A，A 的 norm 定義為：

![](https://i.imgur.com/FE3bt73.png)

A 的 norm 會等於 A 乘上一個向量 x 再除上 x 向量的 norm，這個 x 向量不能為零，然後這整個東西取 max。

這邊我們可以看到我們要透過向量的 norm 來定義矩陣的 norm，我們也可以作改寫，像後面紅色框框那樣。

那就像向量的 norm 有 one norm、two norm 等等，矩陣的 norm 也有這些 norm，那一個矩陣的這些 norm 我們該怎麼去定義它呢? 我們就這樣說：

A 是一個在 $R^{n\times n}$ 下的矩陣，它第 ij 個元素就寫成 $a_{ij}$，那麼 A 矩陣的 one norm 和 infinite norm 就定義成下面這樣

![](https://i.imgur.com/R3diq9b.png)

one norm 就是對一行(column) 裡面的每個元素取絕對值加起來，得到一個數字，然後再換下一行做一樣的事情，又得到一個數字，之後從這些數字裡面找最大的那個，這個最大的數字就是 A 的 one norm。 infinite norm 很像，只是是反過來對列(row) 來操作。

然後有兩個重要的不等式：

![](https://i.imgur.com/7bNoZMw.png)

### Def 7.16

如果 A 自己一直乘下去會是一個零矩陣，我們說矩陣 A 收斂：

![](https://i.imgur.com/zmDVMij.png)

然後收斂會跟下面三點等價：

![](https://i.imgur.com/2Uo0aWz.png)


# Chapter 7-2：特徵值與特徵向量

### Def 7.13

定義相信大家都很清楚了，長這樣：

![](https://i.imgur.com/rIjSxxZ.png)

### Def 7.14

但接下來這個大家可能就沒看過了，一個矩陣 A 的譜半徑(spectral radius) 定義為， 一個矩陣的特徵值掛上絕對值，再去取最大的那個，就是我們 A 矩陣的譜半徑：

![](https://i.imgur.com/T0xhkmd.png)

### Thm 7.15

接下來有一個很重要的定理，我們說 A 是一個在 $R^{n\times n}$ 下的矩陣：

1. 你把 $A^TA$ 的譜半徑找出來再開根號就是 A 的 two norm。
2. 一個矩陣的譜半徑一定小於等於 A 的 norm。

證明如下：

![](https://i.imgur.com/BMCnuOX.png)

# Chapter 7-3 Jacobi 和 Gauss-Siedel 迭代法

什麼是一個迭代法呢? 我們可以想像說我們要解一個 $A\vec x = \vec b$ 的問題，接著看這張圖：

![](https://i.imgur.com/cmmoDRz.png)

紅色那根就是我們要求的向量，接著會有一個 $x_0$，然後我們每次都會透過某種方式算出一個綠色的向量，讓下一次的向量更接近 x，這就是迭代法。

我們要解一個 $A\vec x = \vec b$ 的問題時有兩個方法，一個是迭代法，一個是直接法。我們會的高斯消去法就是直接法的一種，因為就是一直消消消，最後就是我們要求的解了。

那什麼時候要用迭代法，什麼時候要用直接法呢? 答案很簡單，如果直接法能很快解出來，那我們就用直接法，不然就用迭代法。另外，如果 A 是一個稀疏矩陣，裡面有很多 0，那用迭代法也是個很好的選擇。

迭代法會有一個初始條件 $\vec x^{(0)}$，我們希望它最後會收斂到我們要的 $\vec x$，因此會有一個數列從 k = 0 到無限大，讓 $\vec x^{(k)}$ 收斂到 $\vec x$。

![](https://i.imgur.com/x1dlkDy.png)

## Jacobi's Method

先給一個 A 矩陣：

![](https://i.imgur.com/ROwQ7vc.jpg)

下面推到第二列是我們把所有 i = j 的 $a_{ij}x_j$ 拉到外面，接著我們可以推出 $x_i$ 的等式。

但是我們要用這個式子我們仍需要知道右邊 $x_j$ 的值，沒辦法直接求出 $x_i$，但沒關係，這提供了我們一個數列作為一個很好的動件，來發展一個最簡單的迭代法，Jacobi's 方法：

![](https://i.imgur.com/6K9RWuS.jpg)

可以看見這個數列基本上跟剛剛的等式一樣，差別就是我們在 $x_j$ 的上面標了上標 k-1，在 $x_i$ 上面標了上標 k，這樣我們就有了一個數列。

看一下這個例子：

![](https://i.imgur.com/oJpiB0r.png)

這邊 $\vec x$ 的解是 $(1,2,-1,1)^T$，那我們現在要用迭代法來算一次，我們先假設 $\vec x^{(0)} = (0,0,0,0)^T$，這代表 $x_1^{(0)} = 0$，$x_2^{(0)} = 0$，$x_3
^{(0)} = 0$，$x_4^{(0)} = 0$：

![](https://i.imgur.com/ahVZISn.jpg)

代入上面的數列的式子，一直代下去，最後就可以找到一個很接近的解

![](https://i.imgur.com/oTGZ8xx.png)

## Matrix expression of Jacobi's method

前面我們推出來的公式，如果要用電腦來計算，可能得寫一堆判斷條件，為了方便寫程式來算，我們需要新的表示方式。

我們先把 A 矩陣拆成 D + L + U：

![](https://i.imgur.com/aux633o.png)

這樣我們就有：

![](https://i.imgur.com/AKZZ0zT.png)

那我們就可以把 Jacobi 迭代法寫成：

![](https://i.imgur.com/mnl55Bw.png)

如此一來，pseudo code 就會長得像這樣：

![](https://i.imgur.com/TgtmASA.jpg)

Step 4 的停止條件事可以被改寫的，上面這樣代表前一次迭代的值和現在的值兩個相減小於某個可容忍的值時就停止，這個叫做絕對誤差，我們也可以改得像這樣：

![](https://i.imgur.com/3FtfKZ1.png)