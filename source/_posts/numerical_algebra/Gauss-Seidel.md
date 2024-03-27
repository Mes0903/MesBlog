---
title: Gauss-Seidel Metheod
date: 2021/10/13
mathjax: true
description: 數值線代的上課筆記，講的 Gauss-Seidel Metheod，老實說我已經忘光了
tags: numerical_algebra
categories:
- numerical_algebra
---

# Gauss-Seidel Metheod

## Gauss-Seidel Metheod

上次我們用了 Jacobi's method，它操作起來長這樣：

![](https://i.imgur.com/eUlvTE7.png)

然後我們就發現 $\vec x^{(k)}$ 裡的元素 $\vec x_1^{(k)}$, $\vec x_2^{(k)}$, ... , $\vec x_{i-1}^{(k)}$ 都已經被算出來了，那因為 $\vec x_j^{(k)}$ 會比 $\vec x_j^{(k-1)}$ 更準更接近解，所以我們可以把上面的公式換成這樣：

![](https://i.imgur.com/jwym5dn.png)

可以看見我把公式拆成了兩部分，前面那邊是已經算出來的，後面的是還沒算到的，以上面 $\vec x_3^{(k)}$ 的例子來說，$\vec x_1^{(k)}$、$\vec x_2^{(k)}$ 就是已經算出來的，$\vec x_3^{(k)}$、...、$\vec x_n^{(k)}$ 就是還沒算出來的值。

這個方法我們就稱它為 Gauss-Seidel Method，是一種 Jacobi's 的優化。

## Gauss-Seidel Metheod 的矩陣表示法

上次我們把原本的矩陣分成 D、L、U：

![](https://i.imgur.com/sWswU8M.png)

那我們做了優化之後，可以把它寫成這樣：

![](https://i.imgur.com/25V62pp.png)

那一樣我們要讓電腦去跑，所以寫個 pseudocode

輸入(input)：n、矩陣A、rhs 向量 $\vec b$、初始猜測值(initial guess) $\vec {x_0}$、誤差(tolerance) TOL、最大跌代次數 $N_0$

輸出：估計出來的 $\vec x$

:::success
int k = 1;
while $k \leq N_0$ {
$\quad$ set $\vec x = T_g\vec {x_0} + \vec {C_g}$
$\quad$ if ( \|\| $\vec x - \vec {x_0}$ \|\| < TOL), then ouput $\vec x$ and break; 
$\quad$ k = k+1
$\quad$ $\vec {x_0} = x$
}
:::

## Lemma7.18

如果 T 的譜半徑($\rho(T)$) 小於 1，那麼會存在 $(I-T)^{-1} = I + T + T^2 + ... = \Sigma_{j=0}^{\infty}T^j$ 

你可以把它想像成一個公比小於 1 的等比數列 $x^j$，那麼它的和就是 $\Sigma_{j=0}^{\infty} x^j = 1 + x + x^2 + ... = \frac{1}{1-x}$

證明：

![](https://i.imgur.com/GP1eilB.png)

## Thm 7.19

隨便猜一個初始值 $\vec x^{(0)}$，定義為 $\vec x^{(k)} = T\vec x^{(k-1)} + \vec C$ for $k \ge 1$ 的數列 $\{\vec x ^ {(k)}\}_{k=0}^{\infty}$ 會收斂到某個特殊的解 $\vec x = T\vec x + \vec C$ iff $\rho(T) < 1$

證明：

![](https://i.imgur.com/fCm1JUg.png)