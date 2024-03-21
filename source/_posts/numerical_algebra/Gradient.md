---
title: Gradient Method
date: 2021/10/31
tags: numerical_algebra
categories:
- numerical_algebra
---

# 7.4 Gradient Method

### Thm 7.31

給定一個 $\mathbb{R}^{n\times n}$ 裡的 symmetric postive matrix $A$，當我們想解 $A\vec x = \vec b$ 的 $\vec x$ 時，等價於找到能 minimizes $\Phi(\vec y) = \frac{1}{2}<A\vec y, \vec y> - <\vec b, \vec y>$ 的 $\vec x$。

![](https://i.imgur.com/LOtZmeO.png)

而怎麼去找 $\Phi$ 的最小值的方法就叫 Gradient Method

證明：

![](https://i.imgur.com/fv2zm9E.jpg)

而我們利用這個方法去找到每次的 $x^{(k)}$：

![](https://i.imgur.com/ArIx2fZ.jpg)


也就是用上一步的 $x^{(k-1)}$，加上某一個純量(scalar) $\alpha_{k-1}$ 乘上更新的方向 $\vec p^{(k-1)}$

所以我們需要知道 $\vec p^{(k-1)}$ 長怎樣，另外一個就是要知道每一步要跨多大，所以要知道 $\alpha_{k-1}$ 的值是多少，要注意 $\alpha_{k-1}$ 需要大於 0，這樣才會是我們要的方向



### 為什叫 Gradient Method

因為之前有說過如果一個函數可微的話，那麼這個函數的負的 gradient 方向就會指出它最大的遞減方向

![](https://i.imgur.com/MRoyptk.png)

所以 $\vec p^{(k-1)} = -\nabla\Phi(\vec x^{(k-1)})$ 就會是 $\vec x^{(k-1)}$ 那點的最大遞減方向，那麼 $\vec x^{(k-1)}$ 加上 $-\alpha_{k-1}\nabla\Phi(\vec x^{(k-1)})$ 就可以保證越來越小。

這個 $\vec r^{(k-1)}$ 是之前說的那個 residual vector，通常定義是 $\vec r^{(k-1)} = \vec b - A\vec x^{(k-1)}$

所以這樣我們就可以推出我們下一步的解要沿著 residual vector 的方向來做變化

### 找 alpha

接下來要來決定 $\alpha_{k-1}$，推導：

![](https://i.imgur.com/4pWvkzw.jpg)

那我們可以做個簡單的操作來得到 residual vector 的 equation：

![](https://i.imgur.com/kidFBQX.png)

### Pseudo Code

![](https://i.imgur.com/VNSDzVh.png)

![](https://i.imgur.com/zu4TmmL.jpg)