---
title: 最小平方逼近多項式(Polynomials of Least square)
date: 2021/11/7
tags: numerical_algebra
categories:
- numerical_algebra
---

# 8.2 最小平方逼近多項式(Polynomials of Least square)

## 目的

我們想要用一個多項式來逼近另一個 function $f\in C[a,b]$，這個多項式我們寫成 

$Pn(x) = a_0 + a_1x^1 +\ ...\ + a_kx^k = \Sigma_{k=0}^n a_kx^k$

這樣的話 least square error，或一開始的 LDA 的 error 就會長 $f(x) - Pn(x)$，那一樣，我們要找到 $a_0,a_1,\ ...\ ,a_n$ 來最小化 $E$：

![](https://i.imgur.com/vHowcux.png)

## 推導

而我們要最小化這個 $E$ 就要用到 gradient 了，也就是說 $\nabla E(a_0,\ ...\ ,a_n) = 0$，或妳也可以說 $\frac{\partial E}{\partial a_j} = 0,\ j = 0,1,\ ...\ , n$

那我們就可以開始推了：

![](https://i.imgur.com/r8HRJFO.jpg)

因為 A 是個 ill-condition 且稠密的矩陣，如果要解這個線性系統會很麻煩，非常沒有效率，因此我們就要換個建構多項式的方法，其中一種方法就是利用線性獨立來操作

在操作之前要先複習一個概念：一個多項式的集合 $\{\phi_0, \phi_1,\ ...\ , \phi_n\}$ 線性獨立 iff $c_0\phi_0(x) + c_1\phi_1(x)+\ ...\ + c_n\phi_n(x) = 0 \Rightarrow (c_0 = c_1 =\ ...\ = c_n = 0)$

那我們假設 $\phi_j$ 是一個 degree 為 j 的多項式，那麼 $\{\phi_0, \phi_1,\ ...\ , \phi_n\}$ 在任何區間 $[a,b]$ 上都會線性獨立，因為他們 degree 不同，像是 $x^2$ 和 $x$ 就線性獨立

所以現在 $Pn(x) = \Sigma_{k=0}^{n} a_k\phi_k(x)$，那一樣我們要找 $a_0$、$a_1...$ 等係數來最小化 $E$：

![](https://i.imgur.com/FinSVRY.png)

然後一樣找 gradient E = 0：

![](https://i.imgur.com/cRzrtna.jpg)

## 例子

### Example 1. 勒壤得多項式 Legendre Function

![](https://i.imgur.com/eJVFvX8.png)

那個 $L_0$、$L_1$... 是我們取的 $\phi$

### Example 2. 柴比雪夫多項式 Chebyshev polynomials

![](https://i.imgur.com/SluD9H9.jpg)

那個 $T_0$、$T_1$... 是我們取的 $\phi$