---
title: Linear Algebra and Eigenvalues
date: 2021/11/7
tags: numerical_algebra
categories:
- numerical_algebra
---

# 9.1 Linear Algebra and Eigenvalues

## Gershgorin circle

給定一個 $A\in \mathbb{R}^{n\times n}$ 矩陣，$R_i$ 記為一個在複數平面上的圓，圓心是 $a_{ii}$，半徑是 $\Sigma_{j=1,\ i\neq j}^n \ |a_{ij}|$，也就是同一個 row 裡面除了圓心以外的其他元素的總和，所以

$R_i = \{\ z \in \mathbb{C}\ | \ |z - a_{ii}|\ \leq\ \Sigma_{j=1,\ i\neq j}^n \ |a_{ij}|\ \}$，$\forall\ i = 1,2,\ ...\ , n$

A 的特徵值(eigen value) 會被包含在這些圓( $R = \cup_{i=1}^n R_i$ ) 的聯集內，如果 A 是對角矩陣，那麼圓半徑會退化到 0

證明：

![](https://i.imgur.com/Sxfszsy.png)

然後如果有 k 個圓的聯集和剩下的 n-k 個圓聯集沒有交集，那麼前者會包含 k 個特徵值，而後者則恰有 n-k 個特徵值。

要逼近特徵值的我們很常使用迭代法，所以先用 Gershgorin circle 找到一個範圍，拿來讓 initial guess 參考是很不錯的選擇，可以提供很好的 initial guess。

## 例子

![](https://i.imgur.com/90aW0hK.jpg)