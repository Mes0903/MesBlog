---
title: Linux 圖形堆疊：Mesa 與 Xorg
date: 2026-07-12
mathjax: true
tag:
- Linux
- computer-graphic
- Mesa
- OpenGL
- vGPU
category:
- Linux
- computer-graphic
---

# Linux graphic stack：Mesa 與 X11

這次 coscup 準備報一下 Mesa，所以先來寫一篇文章，這篇會結合之前在 OSS-NA 的講稿來把其中 Mesa 的部分講清楚，希望是會弄成一個系列文，後續再把 DRM/KMS 和 SPIR-V 之類的東西提一下。 這篇文會固定以 OpenGL + X11 為主

當我們啟動 Linux 電腦、登入圖形桌面，再點開一個 application 時，螢幕上很快就會出現一個新的視窗。 接著，不論是移動視窗、按下按鈕，還是讓遊戲畫出下一幀，使用者看到的都是持續更新的畫面。 這些看似平常的操作，背後往往需要 application、圖形函式庫、視窗系統、Linux kernel 與顯示裝置一起合作完成

以 application 畫出一幀畫面為例，它必須先描述想畫的內容，取得一塊可以保存結果的空間，再把算好的畫面交給視窗系統。 視窗系統還要判斷視窗位於螢幕的哪裡、哪些部分可以看見，最後才能把更新後的畫面送到顯示裝置

Mesa 位在這段路徑的 userspace。 本文選擇 OpenGL 與 X11 作為具體案例：application 透過 OpenGL 描述要畫的內容，Xorg 保存 X11 objects 並處理各個 clients 的 requests，`twm` 決定視窗的位置、外框與前後順序，GLX 則負責連接 OpenGL 與 X11，讓 application 可以為 X11 視窗建立 rendering 環境並交換畫面

我們會先追蹤一幀畫面如何從 application 進入 Mesa，接著交給 Xorg，最後經 Linux display 路徑出現在螢幕上。 建立這張整體地圖後，後文再沿著相同的路徑進入 Mesa 原始程式碼，逐一拆解 GLX、OpenGL frontend、State Tracker、Gallium、DRI、GBM 與 VirGL

文中的原始程式碼與行號固定在下列版本：

- Mesa：`eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3`
- libX11：`libX11-1.8.7`
- twm：`twm-1.0.12`
- xinit：`xinit-1.4.2`
- X server（X11Libre）：`a6a8bc9464f7d787e91f63957357547e7c85c81f`
- Linux：`0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53`
- virglrenderer：`dc35e4db03144f81637c5ad061f61d3334b078fe`

## Big picture of Mesa & X11

### 從 `glxgears` 看見 X11 client、rendering 與 display

當我們在終端機輸入 `glxgears` 並按下 Enter，桌面上會出現一個新的視窗，紅、綠與藍色齒輪則在裡面持續轉動：

![](./image/glxgears.png)

這個畫面會由一個 X server 與多個 X11 clients 共同完成，兩者之間由 X11 protocol 來規定雙方交換 requests、replies 與 events 的格式。 本文的 X server 是 Xorg 行程，它集中保存了 clients 建立的視窗、顯示相關狀態與輸入狀態，並同時處理多條 client connections。 `glxgears`、`xterm`、`xclock` 與 `twm` 則是彼此獨立的 clients，各自擁有一條 connection

libX11 位在每個 client 行程內。 它接收 `XOpenDisplay()`、`XCreateWindow()` 等 Xlib API 呼叫，把輸入參數編碼成 X11 protocol requests，再將 Xorg 傳回的 replies 與 events 整理成 client-side objects。 `twm` 同樣是獨立的 X11 client，之後會取得 window manager 職責，成為視窗管理政策的 controller

```callgraph
X11 clients（多個獨立行程與 connections）
  ├─ glxgears：建立 Window，產生齒輪內容
  ├─ xterm／xclock：建立各自的 Windows 並更新內容
  └─ twm：之後取得 window manager 職責的 X11 client
       │
       │  libX11 將 API calls 編碼成 requests
       │  replies 與 events 會回到各自的 connection
       ↓
X11 protocol connection boundary
       │
       ↓
Xorg（本例唯一的 X server 行程）
  ├─ 接收多個 clients 的 requests
  ├─ 保存視窗、顯示狀態與 protocol resources
  └─ 將 replies 與 events 傳回對應的 client
```

凡是透過 X11 protocol 向 X server 傳送 requests、接收 replies 與 events 的程式，本文稱為 X11 application。 上圖中的 `glxgears`、`xterm` 與 `xclock` 都是 X11 applications：它們會要求建立視窗、接收輸入事件並更新視窗內容。 齒輪、終端機文字與時鐘指針由各 application 產生。 視窗外圍的青色標題列、視窗位置與 stacking，也就是視窗的前後順序，則由 `twm` 這個 window manager 負責協調

對使用者而言，啟動齒輪只需要一條命令。 對圖形堆疊而言，每轉動一小段角度，都代表 application 要產生下一幀 pixels，視窗系統要把這些 pixels 放進桌面的正確位置，顯示裝置還要在正確的時間讀到更新後的畫面

下面這段程式碼取自 mesademos 的 [`glxgears.c`](https://github.com/JoakimSoderberg/mesademos/blob/master/src/xdemos/glxgears.c)：

<details> <summary><span class = "yellow">展開程式碼</span></summary>

```c
/*
 * Copyright (C) 1999-2001  Brian Paul   All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
 * BRIAN PAUL BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
 * AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/*
 * This is a port of the infamous "gears" demo to straight GLX (i.e. no GLUT)
 * Port by Brian Paul  23 March 2001
 *
 * See usage() below for command line options.
 */

#include <math.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <GL/gl.h>
#include <GL/glx.h>
#include <GL/glxext.h>

#ifndef GLX_MESA_swap_control
#define GLX_MESA_swap_control 1
typedef int (*PFNGLXGETSWAPINTERVALMESAPROC)(void);
#endif

#define BENCHMARK

#ifdef BENCHMARK

/* XXX this probably isn't very portable */

#include <sys/time.h>
#include <unistd.h>

/* return current time (in seconds) */
static double
current_time(void)
{
   struct timeval tv;
#ifdef __VMS
   (void) gettimeofday(&tv, NULL );
#else
   struct timezone tz;
   (void) gettimeofday(&tv, &tz);
#endif
   return (double) tv.tv_sec + tv.tv_usec / 1000000.0;
}

#else /*BENCHMARK*/

/* dummy */
static double
current_time(void)
{
   /* update this function for other platforms! */
   static double t = 0.0;
   static int warn = 1;
   if (warn) {
      fprintf(stderr, "Warning: current_time() not implemented!!\n");
      warn = 0;
   }
   return t += 1.0;
}

#endif /*BENCHMARK*/

#ifndef M_PI
#define M_PI 3.14159265
#endif

/** Event handler results: */
#define NOP 0
#define EXIT 1
#define DRAW 2

static GLfloat view_rotx = 20.0, view_roty = 30.0, view_rotz = 0.0;
static GLint gear1, gear2, gear3;
static GLfloat angle = 0.0;

static GLboolean fullscreen = GL_FALSE;	/* Create a single fullscreen window */
static GLboolean stereo = GL_FALSE;	/* Enable stereo.  */
static GLint samples = 0;               /* Choose visual with at least N samples. */
static GLboolean animate = GL_TRUE;	/* Animation */
static GLfloat eyesep = 5.0;		/* Eye separation. */
static GLfloat fix_point = 40.0;	/* Fixation point distance.  */
static GLfloat left, right, asp;	/* Stereo frustum params.  */

/*
 *
 *  Draw a gear wheel.  You'll probably want to call this function when
 *  building a display list since we do a lot of trig here.
 *
 *  Input:  inner_radius - radius of hole at center
 *          outer_radius - radius at center of teeth
 *          width - width of gear
 *          teeth - number of teeth
 *          tooth_depth - depth of tooth
 */
static void
gear(GLfloat inner_radius, GLfloat outer_radius, GLfloat width,
     GLint teeth, GLfloat tooth_depth)
{
   GLint i;
   GLfloat r0, r1, r2;
   GLfloat angle, da;
   GLfloat u, v, len;

   r0 = inner_radius;
   r1 = outer_radius - tooth_depth / 2.0;
   r2 = outer_radius + tooth_depth / 2.0;

   da = 2.0 * M_PI / teeth / 4.0;

   glShadeModel(GL_FLAT);

   glNormal3f(0.0, 0.0, 1.0);

   /* draw front face */
   glBegin(GL_QUAD_STRIP);
   for (i = 0; i <= teeth; i++) {
      angle = i * 2.0 * M_PI / teeth;
      glVertex3f(r0 * cos(angle), r0 * sin(angle), width * 0.5);
      glVertex3f(r1 * cos(angle), r1 * sin(angle), width * 0.5);
      if (i < teeth) {
	 glVertex3f(r0 * cos(angle), r0 * sin(angle), width * 0.5);
	 glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da),
		    width * 0.5);
      }
   }
   glEnd();

   /* draw front sides of teeth */
   glBegin(GL_QUADS);
   da = 2.0 * M_PI / teeth / 4.0;
   for (i = 0; i < teeth; i++) {
      angle = i * 2.0 * M_PI / teeth;

      glVertex3f(r1 * cos(angle), r1 * sin(angle), width * 0.5);
      glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), width * 0.5);
      glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da),
		 width * 0.5);
      glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da),
		 width * 0.5);
   }
   glEnd();

   glNormal3f(0.0, 0.0, -1.0);

   /* draw back face */
   glBegin(GL_QUAD_STRIP);
   for (i = 0; i <= teeth; i++) {
      angle = i * 2.0 * M_PI / teeth;
      glVertex3f(r1 * cos(angle), r1 * sin(angle), -width * 0.5);
      glVertex3f(r0 * cos(angle), r0 * sin(angle), -width * 0.5);
      if (i < teeth) {
	 glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da),
		    -width * 0.5);
	 glVertex3f(r0 * cos(angle), r0 * sin(angle), -width * 0.5);
      }
   }
   glEnd();

   /* draw back sides of teeth */
   glBegin(GL_QUADS);
   da = 2.0 * M_PI / teeth / 4.0;
   for (i = 0; i < teeth; i++) {
      angle = i * 2.0 * M_PI / teeth;

      glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da),
		 -width * 0.5);
      glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da),
		 -width * 0.5);
      glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), -width * 0.5);
      glVertex3f(r1 * cos(angle), r1 * sin(angle), -width * 0.5);
   }
   glEnd();

   /* draw outward faces of teeth */
   glBegin(GL_QUAD_STRIP);
   for (i = 0; i < teeth; i++) {
      angle = i * 2.0 * M_PI / teeth;

      glVertex3f(r1 * cos(angle), r1 * sin(angle), width * 0.5);
      glVertex3f(r1 * cos(angle), r1 * sin(angle), -width * 0.5);
      u = r2 * cos(angle + da) - r1 * cos(angle);
      v = r2 * sin(angle + da) - r1 * sin(angle);
      len = sqrt(u * u + v * v);
      u /= len;
      v /= len;
      glNormal3f(v, -u, 0.0);
      glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), width * 0.5);
      glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), -width * 0.5);
      glNormal3f(cos(angle), sin(angle), 0.0);
      glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da),
		 width * 0.5);
      glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da),
		 -width * 0.5);
      u = r1 * cos(angle + 3 * da) - r2 * cos(angle + 2 * da);
      v = r1 * sin(angle + 3 * da) - r2 * sin(angle + 2 * da);
      glNormal3f(v, -u, 0.0);
      glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da),
		 width * 0.5);
      glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da),
		 -width * 0.5);
      glNormal3f(cos(angle), sin(angle), 0.0);
   }

   glVertex3f(r1 * cos(0), r1 * sin(0), width * 0.5);
   glVertex3f(r1 * cos(0), r1 * sin(0), -width * 0.5);

   glEnd();

   glShadeModel(GL_SMOOTH);

   /* draw inside radius cylinder */
   glBegin(GL_QUAD_STRIP);
   for (i = 0; i <= teeth; i++) {
      angle = i * 2.0 * M_PI / teeth;
      glNormal3f(-cos(angle), -sin(angle), 0.0);
      glVertex3f(r0 * cos(angle), r0 * sin(angle), -width * 0.5);
      glVertex3f(r0 * cos(angle), r0 * sin(angle), width * 0.5);
   }
   glEnd();
}

static void
draw(void)
{
   glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

   glPushMatrix();
   glRotatef(view_rotx, 1.0, 0.0, 0.0);
   glRotatef(view_roty, 0.0, 1.0, 0.0);
   glRotatef(view_rotz, 0.0, 0.0, 1.0);

   glPushMatrix();
   glTranslatef(-3.0, -2.0, 0.0);
   glRotatef(angle, 0.0, 0.0, 1.0);
   glCallList(gear1);
   glPopMatrix();

   glPushMatrix();
   glTranslatef(3.1, -2.0, 0.0);
   glRotatef(-2.0 * angle - 9.0, 0.0, 0.0, 1.0);
   glCallList(gear2);
   glPopMatrix();

   glPushMatrix();
   glTranslatef(-3.1, 4.2, 0.0);
   glRotatef(-2.0 * angle - 25.0, 0.0, 0.0, 1.0);
   glCallList(gear3);
   glPopMatrix();

   glPopMatrix();
}

static void
draw_gears(void)
{
   if (stereo) {
      /* First left eye.  */
      glDrawBuffer(GL_BACK_LEFT);

      glMatrixMode(GL_PROJECTION);
      glLoadIdentity();
      glFrustum(left, right, -asp, asp, 5.0, 60.0);

      glMatrixMode(GL_MODELVIEW);

      glPushMatrix();
      glTranslated(+0.5 * eyesep, 0.0, 0.0);
      draw();
      glPopMatrix();

      /* Then right eye.  */
      glDrawBuffer(GL_BACK_RIGHT);

      glMatrixMode(GL_PROJECTION);
      glLoadIdentity();
      glFrustum(-right, -left, -asp, asp, 5.0, 60.0);

      glMatrixMode(GL_MODELVIEW);

      glPushMatrix();
      glTranslated(-0.5 * eyesep, 0.0, 0.0);
      draw();
      glPopMatrix();
   }
   else {
      draw();
   }
}

/** Draw single frame, do SwapBuffers, compute FPS */
static void
draw_frame(Display *dpy, Window win)
{
   static int frames = 0;
   static double tRot0 = -1.0, tRate0 = -1.0;
   double dt, t = current_time();

   if (tRot0 < 0.0)
      tRot0 = t;
   dt = t - tRot0;
   tRot0 = t;

   if (animate) {
      /* advance rotation for next frame */
      angle += 70.0 * dt;  /* 70 degrees per second */
      if (angle > 3600.0)
         angle -= 3600.0;
   }

   draw_gears();
   glXSwapBuffers(dpy, win);

   frames++;

   if (tRate0 < 0.0)
      tRate0 = t;
   if (t - tRate0 >= 5.0) {
      GLfloat seconds = t - tRate0;
      GLfloat fps = frames / seconds;
      printf("%d frames in %3.1f seconds = %6.3f FPS\n", frames, seconds,
             fps);
      fflush(stdout);
      tRate0 = t;
      frames = 0;
   }
}

/* new window size or exposure */
static void
reshape(int width, int height)
{
   glViewport(0, 0, (GLint) width, (GLint) height);

   if (stereo) {
      GLfloat w;

      asp = (GLfloat) height / (GLfloat) width;
      w = fix_point * (1.0 / 5.0);

      left = -5.0 * ((w - 0.5 * eyesep) / fix_point);
      right = 5.0 * ((w + 0.5 * eyesep) / fix_point);
   }
   else {
      GLfloat h = (GLfloat) height / (GLfloat) width;

      glMatrixMode(GL_PROJECTION);
      glLoadIdentity();
      glFrustum(-1.0, 1.0, -h, h, 5.0, 60.0);
   }

   glMatrixMode(GL_MODELVIEW);
   glLoadIdentity();
   glTranslatef(0.0, 0.0, -40.0);
}

static void
init(void)
{
   static GLfloat pos[4] = { 5.0, 5.0, 10.0, 0.0 };
   static GLfloat red[4] = { 0.8, 0.1, 0.0, 1.0 };
   static GLfloat green[4] = { 0.0, 0.8, 0.2, 1.0 };
   static GLfloat blue[4] = { 0.2, 0.2, 1.0, 1.0 };

   glLightfv(GL_LIGHT0, GL_POSITION, pos);
   glEnable(GL_CULL_FACE);
   glEnable(GL_LIGHTING);
   glEnable(GL_LIGHT0);
   glEnable(GL_DEPTH_TEST);

   /* make the gears */
   gear1 = glGenLists(1);
   glNewList(gear1, GL_COMPILE);
   glMaterialfv(GL_FRONT, GL_AMBIENT_AND_DIFFUSE, red);
   gear(1.0, 4.0, 1.0, 20, 0.7);
   glEndList();

   gear2 = glGenLists(1);
   glNewList(gear2, GL_COMPILE);
   glMaterialfv(GL_FRONT, GL_AMBIENT_AND_DIFFUSE, green);
   gear(0.5, 2.0, 2.0, 10, 0.7);
   glEndList();

   gear3 = glGenLists(1);
   glNewList(gear3, GL_COMPILE);
   glMaterialfv(GL_FRONT, GL_AMBIENT_AND_DIFFUSE, blue);
   gear(1.3, 2.0, 0.5, 10, 0.7);
   glEndList();

   glEnable(GL_NORMALIZE);
}

/**
 * Remove window border/decorations.
 */
static void
no_border( Display *dpy, Window w)
{
   static const unsigned MWM_HINTS_DECORATIONS = (1 << 1);
   static const int PROP_MOTIF_WM_HINTS_ELEMENTS = 5;

   typedef struct
   {
      unsigned long       flags;
      unsigned long       functions;
      unsigned long       decorations;
      long                inputMode;
      unsigned long       status;
   } PropMotifWmHints;

   PropMotifWmHints motif_hints;
   Atom prop, proptype;
   unsigned long flags = 0;

   /* setup the property */
   motif_hints.flags = MWM_HINTS_DECORATIONS;
   motif_hints.decorations = flags;

   /* get the atom for the property */
   prop = XInternAtom( dpy, "_MOTIF_WM_HINTS", True );
   if (!prop) {
      /* something went wrong! */
      return;
   }

   /* not sure this is correct, seems to work, XA_WM_HINTS didn't work */
   proptype = prop;

   XChangeProperty( dpy, w,                         /* display, window */
                    prop, proptype,                 /* property, type */
                    32,                             /* format: 32-bit datums */
                    PropModeReplace,                /* mode */
                    (unsigned char *) &motif_hints, /* data */
                    PROP_MOTIF_WM_HINTS_ELEMENTS    /* nelements */
                  );
}

/*
 * Create an RGB, double-buffered window.
 * Return the window and context handles.
 */
static void
make_window( Display *dpy, const char *name,
             int x, int y, int width, int height,
             Window *winRet, GLXContext *ctxRet)
{
   int attribs[64];
   int i = 0;

   int scrnum;
   XSetWindowAttributes attr;
   unsigned long mask;
   Window root;
   Window win;
   GLXContext ctx;
   XVisualInfo *visinfo;

   /* Singleton attributes. */
   attribs[i++] = GLX_RGBA;
   attribs[i++] = GLX_DOUBLEBUFFER;
   if (stereo)
      attribs[i++] = GLX_STEREO;

   /* Key/value attributes. */
   attribs[i++] = GLX_RED_SIZE;
   attribs[i++] = 1;
   attribs[i++] = GLX_GREEN_SIZE;
   attribs[i++] = 1;
   attribs[i++] = GLX_BLUE_SIZE;
   attribs[i++] = 1;
   attribs[i++] = GLX_DEPTH_SIZE;
   attribs[i++] = 1;
   if (samples > 0) {
      attribs[i++] = GLX_SAMPLE_BUFFERS;
      attribs[i++] = 1;
      attribs[i++] = GLX_SAMPLES;
      attribs[i++] = samples;
   }

   attribs[i++] = None;

   scrnum = DefaultScreen( dpy );
   root = RootWindow( dpy, scrnum );

   visinfo = glXChooseVisual(dpy, scrnum, attribs);
   if (!visinfo) {
      printf("Error: couldn't get an RGB, Double-buffered");
      if (stereo)
         printf(", Stereo");
      if (samples > 0)
         printf(", Multisample");
      printf(" visual\n");
      exit(1);
   }

   /* window attributes */
   attr.background_pixel = 0;
   attr.border_pixel = 0;
   attr.colormap = XCreateColormap( dpy, root, visinfo->visual, AllocNone);
   attr.event_mask = StructureNotifyMask | ExposureMask | KeyPressMask;
   /* XXX this is a bad way to get a borderless window! */
   mask = CWBackPixel | CWBorderPixel | CWColormap | CWEventMask;

   win = XCreateWindow( dpy, root, x, y, width, height,
		        0, visinfo->depth, InputOutput,
		        visinfo->visual, mask, &attr );

   if (fullscreen)
      no_border(dpy, win);

   /* set hints and properties */
   {
      XSizeHints sizehints;
      sizehints.x = x;
      sizehints.y = y;
      sizehints.width  = width;
      sizehints.height = height;
      sizehints.flags = USSize | USPosition;
      XSetNormalHints(dpy, win, &sizehints);
      XSetStandardProperties(dpy, win, name, name,
                              None, (char **)NULL, 0, &sizehints);
   }

   ctx = glXCreateContext( dpy, visinfo, NULL, True );
   if (!ctx) {
      printf("Error: glXCreateContext failed\n");
      exit(1);
   }

   XFree(visinfo);

   *winRet = win;
   *ctxRet = ctx;
}

/**
 * Determine whether or not a GLX extension is supported.
 */
static int
is_glx_extension_supported(Display *dpy, const char *query)
{
   const int scrnum = DefaultScreen(dpy);
   const char *glx_extensions = NULL;
   const size_t len = strlen(query);
   const char *ptr;

   if (glx_extensions == NULL) {
      glx_extensions = glXQueryExtensionsString(dpy, scrnum);
   }

   ptr = strstr(glx_extensions, query);
   return ((ptr != NULL) && ((ptr[len] == ' ') || (ptr[len] == '\0')));
}

/**
 * Attempt to determine whether or not the display is synched to vblank.
 */
static void
query_vsync(Display *dpy, GLXDrawable drawable)
{
   int interval = 0;

#if defined(GLX_EXT_swap_control)
   if (is_glx_extension_supported(dpy, "GLX_EXT_swap_control")) {
       unsigned int tmp = -1;
       glXQueryDrawable(dpy, drawable, GLX_SWAP_INTERVAL_EXT, &tmp);
       interval = tmp;
   } else
#endif
   if (is_glx_extension_supported(dpy, "GLX_MESA_swap_control")) {
      PFNGLXGETSWAPINTERVALMESAPROC pglXGetSwapIntervalMESA =
          (PFNGLXGETSWAPINTERVALMESAPROC)
          glXGetProcAddressARB((const GLubyte *) "glXGetSwapIntervalMESA");

      interval = (*pglXGetSwapIntervalMESA)();
   } else if (is_glx_extension_supported(dpy, "GLX_SGI_swap_control")) {
      /* The default swap interval with this extension is 1.  Assume that it
       * is set to the default.
       *
       * Many Mesa-based drivers default to 0, but all of these drivers also
       * export GLX_MESA_swap_control.  In that case, this branch will never
       * be taken, and the correct result should be reported.
       */
      interval = 1;
   }

   if (interval > 0) {
      printf("Running synchronized to the vertical refresh.  The framerate should be\n");
      if (interval == 1) {
         printf("approximately the same as the monitor refresh rate.\n");
      } else if (interval > 1) {
         printf("approximately 1/%d the monitor refresh rate.\n",
                interval);
      }
   }
}

/**
 * Handle one X event.
 * \return NOP, EXIT or DRAW
 */
static int
handle_event(Display *dpy, Window win, XEvent *event)
{
   (void) dpy;
   (void) win;

   switch (event->type) {
   case Expose:
      return DRAW;
   case ConfigureNotify:
      reshape(event->xconfigure.width, event->xconfigure.height);
      break;
   case KeyPress:
      {
         char buffer[10];
         int code;
         code = XLookupKeysym(&event->xkey, 0);
         if (code == XK_Left) {
            view_roty += 5.0;
         }
         else if (code == XK_Right) {
            view_roty -= 5.0;
         }
         else if (code == XK_Up) {
            view_rotx += 5.0;
         }
         else if (code == XK_Down) {
            view_rotx -= 5.0;
         }
         else {
            XLookupString(&event->xkey, buffer, sizeof(buffer),
                          NULL, NULL);
            if (buffer[0] == 27) {
               /* escape */
               return EXIT;
            }
            else if (buffer[0] == 'a' || buffer[0] == 'A') {
               animate = !animate;
            }
         }
         return DRAW;
      }
   }
   return NOP;
}

static void
event_loop(Display *dpy, Window win)
{
   while (1) {
      int op;
      while (!animate || XPending(dpy) > 0) {
         XEvent event;
         XNextEvent(dpy, &event);
         op = handle_event(dpy, win, &event);
         if (op == EXIT)
            return;
         else if (op == DRAW)
            break;
      }

      draw_frame(dpy, win);
   }
}

static void
usage(void)
{
   printf("Usage:\n");
   printf("  -display <displayname>  set the display to run on\n");
   printf("  -stereo                 run in stereo mode\n");
   printf("  -samples N              run in multisample mode with at least N samples\n");
   printf("  -fullscreen             run in fullscreen mode\n");
   printf("  -info                   display OpenGL renderer info\n");
   printf("  -geometry WxH+X+Y       window geometry\n");
}

int
main(int argc, char *argv[])
{
   unsigned int winWidth = 300, winHeight = 300;
   int x = 0, y = 0;
   Display *dpy;
   Window win;
   GLXContext ctx;
   char *dpyName = NULL;
   GLboolean printInfo = GL_FALSE;
   int i;

   for (i = 1; i < argc; i++) {
      if (strcmp(argv[i], "-display") == 0) {
         dpyName = argv[i+1];
         i++;
      }
      else if (strcmp(argv[i], "-info") == 0) {
         printInfo = GL_TRUE;
      }
      else if (strcmp(argv[i], "-stereo") == 0) {
         stereo = GL_TRUE;
      }
      else if (i < argc-1 && strcmp(argv[i], "-samples") == 0) {
         samples = strtod(argv[i+1], NULL );
         ++i;
      }
      else if (strcmp(argv[i], "-fullscreen") == 0) {
         fullscreen = GL_TRUE;
      }
      else if (i < argc-1 && strcmp(argv[i], "-geometry") == 0) {
         XParseGeometry(argv[i+1], &x, &y, &winWidth, &winHeight);
         i++;
      }
      else {
         usage();
         return -1;
      }
   }

   dpy = XOpenDisplay(dpyName);
   if (!dpy) {
      printf("Error: couldn't open display %s\n",
	     dpyName ? dpyName : getenv("DISPLAY"));
      return -1;
   }

   if (fullscreen) {
      int scrnum = DefaultScreen(dpy);

      x = 0; y = 0;
      winWidth = DisplayWidth(dpy, scrnum);
      winHeight = DisplayHeight(dpy, scrnum);
   }

   make_window(dpy, "glxgears", x, y, winWidth, winHeight, &win, &ctx);
   XMapWindow(dpy, win);
   glXMakeCurrent(dpy, win, ctx);
   query_vsync(dpy, win);

   if (printInfo) {
      printf("GL_RENDERER   = %s\n", (char *) glGetString(GL_RENDERER));
      printf("GL_VERSION    = %s\n", (char *) glGetString(GL_VERSION));
      printf("GL_VENDOR     = %s\n", (char *) glGetString(GL_VENDOR));
      printf("GL_EXTENSIONS = %s\n", (char *) glGetString(GL_EXTENSIONS));
   }

   init();

   /* Set initial projection/viewing transformation.
    * We can't be sure we'll get a ConfigureNotify event when the window
    * first appears.
    */
   reshape(winWidth, winHeight);

   event_loop(dpy, win);

   glDeleteLists(gear1, 1);
   glDeleteLists(gear2, 1);
   glDeleteLists(gear3, 1);
   glXMakeCurrent(dpy, None, NULL);
   glXDestroyContext(dpy, ctx);
   XDestroyWindow(dpy, win);
   XCloseDisplay(dpy);

   return 0;
}
```

</details>

#### 齒輪轉動一格，需要 rendering 與 display 兩條路徑

首先我們需要把 rendering 與 display 區分開來。 Application 準備算繪時，會透過 OpenGL 提供幾何資料、顏色與 rendering state。 Rendering 路徑負責把這些 OpenGL operations 轉成可執行的工作，再由 CPU 或 GPU 算出 pixels。 Display 路徑則由視窗系統與 Linux display subsystem 選出目前要顯示的 buffer，決定畫面位於桌面的哪裡，再讓 display controller 持續讀取該 buffer

而在本文討論的情境中，我們可以將 GPU driver 堆疊分成 userspace 與 kernel 兩個部分。 以 AMD GPU 為例：

- userspace 部分會以共享函式庫的形式載入至 application 行程。 以 Mesa 的 AMD 路徑為例，OpenGL frontend 先接收並驗證 API operations，State Tracker 再把 OpenGL state 轉成 driver 可以處理的形式，radeonsi 最後建立 AMD GPU commands。 這一側會透過 DRM ioctl 將 resource-management 與 command-submission requests 送進 kernel
- kernel 部分由 Linux 的 DRM driver 實作。 在這個例子中，`amdgpu` 負責管理 GEM／buffer object、GPU 虛擬位址、command submission、排程、同步、interrupt 與 reset

Display 路徑還會使用 Linux DRM 的 KMS。 這裡只要先知道 scanout framebuffer 是 KMS 用來引用顯示 storage 的 object。 Framebuffer 之後如何接上完整的 display topology，會等 Xorg child 進入裝置初始化後再展開

一幀畫面的 rendering 與 display 路徑大致如下：

```
Rendering 路徑：產生這一幀的內容
=================================================
Application 更新齒輪角度並發出 OpenGL operations
  │
  │  geometry、color、transform 與 framebuffer state
  ↓
OpenGL userspace 實作
  │
  │  驗證 API state，執行 CPU rendering
  │  或準備 GPU 可以執行的 commands
  ↓
rendered color buffer
  │
  ↓
畫面交付與 display 路徑：讓這一幀出現在桌面的正確位置
=================================================
rendered color buffer
  │
  │  GLX 將完成的一幀畫面對到一個 X11 Window
  ↓
X server
  │
  │  套用 Window 的位置與可見範圍
  ↓
X server 管理的 display storage
  │
  │  DRM／KMS 選擇 scanout framebuffer
  ↓
display controller 週期性讀取 pixels
  ↓
使用者看見齒輪轉到下一個角度
```

Application 可以先在 off-screen color buffer 完成 rendering。 此時 pixels 已經存在，卻還沒有進入桌面的最終畫面。 視窗的位置、父子關係、stacking 與可見範圍，則會先由 X11 的視窗管理流程建立。 兩條路徑在 `glXSwapBuffers()` 之後的畫面交付邊界會合

### 使用者執行 `startx` 後，Xorg 如何準備好顯示環境

齒輪程式能連線以前，使用者必須先啟動圖形桌面。 我們會從使用者執行 `startx` 開始，看它如何啟動 Xorg，再沿著 Xorg 內部的共用核心、裝置相依框架與顯示 driver，走到 Linux DRM／KMS 準備的顯示路徑

#### 使用者啟動圖形桌面：`startx` 呼叫 `xinit`

在我們的例子中，當 Linux 開機並進入文字終端機後，若使用者想啟動圖形桌面，需要手動執行 `startx` 命令，開始建立圖形工作環境。 啟動完成後，螢幕上會出現由 `twm` 管理的 `xclock` 與 `xterm` 視窗，使用者接著便能從 `xterm` 開啟 `glxgears`

本文把從 Xorg 啟動、桌面程式陸續連入並持續運作，到使用者離開桌面為止的完整圖形工作階段稱為 X11 session。 本文使用三個元件啟動這個 session：

- `startx` 是使用者執行的 shell wrapper。 它選出 X server 與 session script，整理兩者各自需要的 arguments，再執行 `xinit`
- `xinit` 是由 C 原始程式碼編譯出的 executable。 它先啟動 Xorg，等待 X server 可以接受 connection，再啟動 session script
- `xinitrc` 是 shell script，用來列出 session 要啟動的 clients。 本文使用的 system `xinitrc` 會啟動 `twm`、`xclock` 與 `xterm`

`startx` 最後傳給 `xinit` 的命令分成兩組 arguments。 `--` 前方指定要執行的 session script 及其 arguments，後方指定 X server executable、display name 與 server arguments。 `xinit` 因此知道要先啟動哪一個 X server，也知道 server ready 後要執行哪一份 session script

這套啟動路徑需要 Xorg、libX11、`twm`、`xclock`、`xinit` 與 `xterm`。 以下設定來自 [`semu: configs/x11.config:17`](https://github.com/sysprog21/semu/blob/fd0812970c3c934b46e4897284894e9705355b50/configs/x11.config#L17-L26)，用來確認 Buildroot 會把這些彼此獨立的 X11 元件放進 guest root filesystem：

```config
# [semu: configs/x11.config:17-24]
BR2_PACKAGE_XORG7=y
BR2_PACKAGE_XSERVER_XORG_SERVER=y
BR2_PACKAGE_XSERVER_XORG_SERVER_MODULAR=y
BR2_PACKAGE_XLIB_LIBX11=y
BR2_PACKAGE_XAPP_TWM=y
...
BR2_PACKAGE_XAPP_XCLOCK=y
BR2_PACKAGE_XAPP_XINIT=y

# [semu: configs/x11.config:26]
BR2_PACKAGE_XTERM=y
```

本文固定的命令與環境條件會讓 `startx` 選用 system `xinitrc`。 使用者直接執行 `startx`，不另外指定 client 或 client arguments。 `$HOME/.xinitrc` 不存在，`XINITRC` 與 `XSERVERRC` 也沒有指向有效檔案。 這些條件讓 [`xinit: startx.cpp:182`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/startx.cpp#L182-194) 選擇 system `xinitrc`

[`xinit: startx.cpp:310`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/startx.cpp#L307-310) 最後會執行 `xinit`。 [`xinit: xinit.c:294`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/xinit.c#L294-300) 的 call site 具有 short-circuit 順序，因此 `main()` 會先呼叫 [`xinit: xinit.c:394`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/xinit.c#L394-453) 的 `startServer()`。 `startServer()` 成功回傳後，`main()` 再進入 session client branch

```callgraph
使用者執行 startx
  │
  ↓
[xinit: startx.cpp:50] startx shell script
  │
  │  userclientrc=$HOME/.xinitrc
  ├─ 若 XINITRC 指向有效檔案：userclientrc=$XINITRC
  ├─ 若 XSERVERRC 指向有效檔案：userclientrc=$XSERVERRC
  │    // xinit 1.4.2 的 line 55 也會覆寫 userclientrc
  ↓
[xinit: startx.cpp:182] startx shell script
  │
  ├─ startx 沒有收到 client 與 client arguments
  ├─ client = defaultclient，clientargs 為空
  ├─ $HOME/.xinitrc 不存在
  ├─ XINITRC 與 XSERVERRC 沒有指向有效檔案
  │    // userclientrc 沒有指向可執行的自訂 xinitrc
  └─ system xinitrc 存在：client = sysclientrc
  ↓
[xinit: startx.cpp:310] startx shell script
  │
  │  XINIT "$client" $clientargs -- "$server" $display $serverargs
  │  // client 指向 system xinitrc，server 指向 Xorg executable
  ↓
[xinit: xinit.c:146] int main(int argc, char *argv[])
  │
  │  [xinit: xinit.c:294]
  │  先判斷 startServer(server) > 0
  ↓
[xinit: xinit.c:394]
static pid_t startServer(char *server_argv[])
  │
  ├─ server child：Execute(server_argv)
  │    └─ 啟動 Xorg
  │
  └─ xinit parent：
       ├─ alarm(15)
       └─ sigsuspend(&old)
            // 等 Xorg 的 SIGUSR1，或在 15 秒後醒來
```

`startServer()` 呼叫 `fork()` 後，server child 會透過 `Execute(server_argv)` 啟動 Xorg，`xinit` parent 則設定 15 秒的 alarm，接著停在 `sigsuspend()`。 兩條執行路徑從這裡分開：Xorg child 繼續初始化顯示裝置，`xinit` parent 等待 Xorg 的通知。 接下來先沿 Xorg child 往下看，等它送出 SIGUSR1 後，再回到 parent 的 `waitforserver()`

#### 使用者仍在等待：Xorg 先找出可用的顯示裝置

使用者此時仍看著文字終端機。 第一個 client 連入後，需要先知道自己能在哪一個桌面座標系統建立視窗，也需要知道這個桌面的尺寸與可用 pixel formats。 X11 把這一組顯示資源稱為 X Screen

每個 X Screen 都有自己的座標系統、寬度、高度、depths 與 visuals，並以一個 Root Window 作為該 Screen 的 Window tree 根節點。 Xorg 必須先找出本文使用的顯示裝置，才能建立符合實際 display setup 的 X Screen，再在 client 建立 connection 時把這些資料回傳給它

管理共通的 X11 state 與處理裝置相依工作是兩種責任，Xorg 原始程式碼也據此分成 DIX 與 DDX。 DIX（Device Independent X）是 X server 的裝置獨立核心，負責 protocol dispatch、resource table，以及共用的 Screen／Window runtime state。 不論底下接的是哪種顯示環境，clients 都會透過 DIX 使用相同的 X11 protocol objects

DDX（Device Dependent X）則是 X server 接到實際平台、顯示與輸入環境的裝置相依部分。 它提供 DIX 所需的裝置操作，讓共用核心不必直接知道硬體、作業系統介面或顯示後端的細節

本文執行的是 Xorg，其中 `hw/xfree86/` 保存從 XFree86 延續而來的 DDX 框架。 `xf86` 這個歷史名稱因而保留在框架的目錄、API 與識別字中

本文組態中的 `Driver "modesetting"` 會選到 XFree86 DDX 的 modesetting display driver。 這個 userspace driver 會提供 `PreInit`、`ScreenInit` 等 callbacks，讓 XFree86 DDX 框架能初始化實際的 Linux DRM 顯示裝置

建立顯示 buffer 時，modesetting driver 會使用 GBM。 GBM 是一組 buffer-management API 與 object model，Mesa 的 `libgbm` 則是本文載入的 userspace library 實作。 Xorg 將 DRM device fd、尺寸、pixel format 與 usage flags 交給 `libgbm`，成功後取得一個 `struct gbm_bo *`。 libdrm 再把 userspace 發出的 DRM／KMS operations 包裝成相應的 ioctl requests

本節追蹤的 Xorg display path 如下：

```callgraph
Xorg 行程
  ↓
DIX：X server 共用核心
  ↓
XFree86 DDX 框架
  ↓
modesetting：Xorg userspace display driver
  ↓
GBM／libdrm
  ↓
Linux DRM／KMS driver
```

Display 路徑進入 kernel 後會使用 KMS。 KMS 是 Linux DRM 的 display subsystem，定義 framebuffer、plane、CRTC、encoder、connector 與 display mode 等 object，再由具體的 DRM driver 實作這些 objects 的 operations

Rendering 與 KMS 可以由同一個 DRM driver 實作，也可以由不同的 drivers 分工。 本文接下來選定的組態會讓 application 在 userspace 使用 CPU 完成 rendering，kernel 的 DRM driver 則負責 display buffer 與 KMS state

KMS 的 scanout object chain 依序是 framebuffer → plane → CRTC → encoder → connector。 Userspace 會提交 buffer、mode 與各個 objects 的連接關係，DRM core 與 driver 再把這些輸入轉成 display controller 能執行的狀態

Framebuffer 是 kernel object，引用保存 pixels 的 buffer object，並描述 scanout 所需的 pixel format、尺寸與 pitch。 Xorg 稍後會透過 `ADDFB` ioctl 請 DRM core 與 driver 建立這個 object，成功後取得一個 `fb_id`，後續再以該 ID 引用它

Plane 的 state 會選擇 framebuffer，並保存 source rectangle 與 pixels 在 CRTC 畫面中的位置。 CRTC 的 state 保存 active mode 與掃描時序。 Encoder 表示 CRTC 到 connector 之間的 routing stage，connector 則代表可供 userspace 查詢 modes 的實體或虛擬顯示端點

Linux driver 探測顯示裝置時，會先建立 plane、CRTC、encoder 與 connector，等待 userspace 提供 framebuffer 與 mode state。 Primary plane 是本例整個桌面的 pixel source，cursor plane 則讓滑鼠指標可以獨立更新。 `output->index` 之後會成為 virtio-gpu protocol 使用的 scanout ID

#### 本文固定追蹤的圖形組態

走到這裡，我們已經知道 `startx` 如何啟動 Xorg，也知道 Xorg 會經過 DIX、XFree86 DDX、modesetting、GBM／libdrm 與 DRM／KMS。 接下來要進入各層的原始程式碼，因此先把同一個齒輪視窗放進一組固定的測試環境

Rendering 這一側還會用到 GLX、Gallium、softpipe 與 `drisw`。 GLX 連接 OpenGL 與 X11 Window，讓 Mesa 知道算好的畫面要交給哪一個視窗。 Gallium 是 Mesa frontend 與 rendering drivers 之間共用的介面。 本文選擇的 softpipe 會用 guest CPU 算出 pixels，`drisw` 則在 swap 時把 pixels 交給 X server

這個範例固定使用下列目標組態：

- 使用者以 `startx`／`xinit` 啟動 Xorg、`twm`、`xclock` 與 `xterm`。 `twm` 擔任 window manager。 這組桌面程式中不啟動負責合成各視窗內容的 compositor
- OpenGL 使用 Mesa 的 direct software GLX path，Gallium 軟體 driver 固定為 softpipe。 Rendering work 留在 application 行程，由 guest CPU 執行
- Xorg 使用 modesetting driver 管理顯示裝置。 各視窗不會被重新導向各自的 off-screen storage，可見 pixels 會直接寫進 Xorg 管理的整張桌面 storage
- Xorg 透過 Mesa `libgbm` 配置一份可由 CPU 寫入、也能供 KMS scanout 的整桌 buffer。 本文固定追蹤 `GBM_BO_USE_WRITE | GBM_BO_USE_SCANOUT` candidate，沿著它進入 `DRM_IOCTL_MODE_CREATE_DUMB`。 這是 DRM／KMS 提供的基礎線性 buffer 建立介面
- Guest 顯示裝置使用 virtio-gpu 2D。 `VIRTIO_GPU_F_VIRGL` 與 `VIRTIO_GPU_F_RESOURCE_BLOB` 均未協商，因此 kernel 會以 `RESOURCE_CREATE_2D` 建立傳統 2D resource，再用 `RESOURCE_ATTACH_BACKING` 接上 guest memory
- Host emulator 使用 SDL2 display backend。 後文將這個終點稱為「本例的 SDL window」

Xorg 的裝置設定如下：

```conf
Section "Device"
    Identifier "virtio-gpu"
    Driver "modesetting"
    Option "AccelMethod" "none"
    Option "ShadowFB" "off"
EndSection
```

Application 啟動時固定設定：

```bash
export LIBGL_ALWAYS_SOFTWARE=true
export GALLIUM_DRIVER=softpipe
```

這組條件會把 application 的 OpenGL work 留在 guest CPU 上執行，算好的 pixels 再經 X server、DRM／KMS 與 virtio-gpu 走到本例的 SDL window

本文把 softpipe 這類使用 CPU 產生 pixels 的元件統稱為軟體 renderer。 llvmpipe 是另一個 Gallium 軟體 driver，classic swrast 則是 Mesa 傳統的軟體 rasterizer。 本文主線仍固定使用 softpipe

Rendering 這一側的選擇確定後，現在回到 display device。 Linux `virtio_gpu` driver 會在 Xorg 啟動前先完成 device probe，為每個 `struct virtio_gpu_output` 建立 primary plane、cursor plane、CRTC、virtual encoder 與 virtual connector。 以下節錄來自 [`Linux: drivers/gpu/drm/virtio/virtgpu_display.c:274`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/gpu/drm/virtio/virtgpu_display.c?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n274)：

```c
// [Linux: drivers/gpu/drm/virtio/virtgpu_display.c:274]
static int
vgdev_output_init(struct virtio_gpu_device *vgdev, int index)
{
    struct drm_device *dev = vgdev->ddev;
    struct virtio_gpu_output *output = vgdev->outputs + index;
    struct drm_connector *connector = &output->conn;
    struct drm_encoder *encoder = &output->enc;
    struct drm_crtc *crtc = &output->crtc;
    struct drm_plane *primary, *cursor;
    ...

    primary = virtio_gpu_plane_init(vgdev, DRM_PLANE_TYPE_PRIMARY, index);
    ...
    cursor = virtio_gpu_plane_init(vgdev, DRM_PLANE_TYPE_CURSOR, index);
    ...
    ret = drm_crtc_init_with_planes(dev, crtc, primary, cursor,
                                    &virtio_gpu_crtc_funcs, NULL);
    ...
    drm_connector_init(dev, connector, &virtio_gpu_connector_funcs,
                       DRM_MODE_CONNECTOR_VIRTUAL);
    ...
    drm_simple_encoder_init(dev, encoder, DRM_MODE_ENCODER_VIRTUAL);
    ...
    drm_connector_attach_encoder(connector, encoder);
    drm_connector_register(connector);
    return 0;
}
```

每個 `struct virtio_gpu_output` 內嵌 CRTC、connector、encoder 與 scanout metadata。 Primary 與 cursor planes 由 `virtio_gpu_plane_init()` 另行配置，再 attach 到該 CRTC。 這些 KMS objects 均由 kernel DRM device 管理

這組 topology 已在 kernel probe 建立。 Xorg 接下來要做的是建立 X Screen 與整張桌面的 display buffer，再透過 KMS framebuffer 將該 storage 綁進既有 topology

#### Xorg 建立第一個 X Screen：從 `ScrnInfoRec` 到 `ScreenRec`

使用者仍在等待。 Xorg 已經找出顯示裝置與 KMS topology，現在要把這些資料整理成第一個 X Screen。 在任何 client 能選擇 X Screen、取得 Root Window 或建立自己的 Window 以前，server-side records 必須先存在

本節先追蹤 XFree86 DDX 的 `ScrnInfoRec` 如何接到 DIX 的 `ScreenRec`，並在 modesetting `ScreenInit()` callback 邊界停下。 Connection setup reply 會在整張桌面的 display storage 建立後處理

##### XFree86 DDX 先建立 driver-facing record

XFree86 DDX 先以 `ScrnInfoRec` 保存一個 X Screen 的 driver-facing 組態與 callbacks

這筆記錄會保存預設 depth、bits per pixel、virtual size 與 driver private data，以及稍後由 display driver 提供的 `ScreenInit` callback

下面四段程式碼來自：

- [`Xorg: include/xlibre_ptrtypes.h:26`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/xlibre_ptrtypes.h#L26-L27)
- [`Xorg: include/xf86str.h:567`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/xf86str.h#L567-L688)
- [`Xorg: include/xf86.h:52`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/xf86.h#L52)
- [`Xorg: hw/xfree86/common/xf86Globals.c:49`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Globals.c#L49)

第一段讓 `ScrnInfoRec` 與 `ScrnInfoPtr` 分別成為 `struct _ScrnInfoRec` 及其 pointer 的別名。 第二段列出本文會用到的欄位，後兩段則確認 `xf86Screens` 的宣告與實際定義：

```c
// [Xorg: include/xlibre_ptrtypes.h:26-27]
typedef struct _ScrnInfoRec *ScrnInfoPtr;
typedef struct _ScrnInfoRec ScrnInfoRec;

// [Xorg: include/xf86str.h:567-688]
struct _ScrnInfoRec {
    ...
    ScreenPtr pScreen;
    int scrnIndex;
    ...
    int bitsPerPixel;
    int depth;
    ...
    int virtualX;
    int virtualY;
    ...
    void *driverPrivate;
    ...
    xf86ScreenInitProc *ScreenInit;
    ...
};

// [Xorg: include/xf86.h:52]
extern _X_EXPORT ScrnInfoPtr *xf86Screens;

// [Xorg: hw/xfree86/common/xf86Globals.c:49]
ScrnInfoPtr *xf86Screens = NULL;
```

`xf86Screens` 是 `ScrnInfoPtr` 的動態陣列。 `xf86Screens[i]` 指向第 `i` 筆 `ScrnInfoRec`，供 XFree86 DDX 與 display driver 保存裝置組態及 callbacks。 [`Xorg: hw/xfree86/common/xf86Helper.c:155`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Helper.c#L155-L200) 的 `xf86AllocateScreen()` 會擴充這個陣列、配置一筆記錄，再將同一個索引存進 `scrnIndex`：

```c
// [Xorg: hw/xfree86/common/xf86Helper.c:155-200]
/* Allocate a new ScrnInfoRec in xf86Screens */
ScrnInfoPtr
xf86AllocateScreen(DriverPtr drv, int flags)
{
    int i;
    ScrnInfoPtr pScrn;

    if (flags & XF86_ALLOCATE_GPU_SCREEN) {
        ...
    } else {
        if (xf86Screens == NULL)
            xf86NumScreens = 0;

        i = xf86NumScreens++;
        xf86Screens = XNFreallocarray(xf86Screens, xf86NumScreens,
                                      sizeof(ScrnInfoPtr));
        xf86Screens[i] = XNFcallocarray(1, sizeof(ScrnInfoRec));
        pScrn = xf86Screens[i];
        pScrn->scrnIndex = i;
    }

    pScrn->origIndex = pScrn->scrnIndex;
    pScrn->privates = XNFcallocarray(xf86ScrnInfoPrivateCount,
                                     sizeof(DevUnion));
    ...
    pScrn->drv = drv;
    ...
    return pScrn;
}
```

modesetting 在探測平台裝置時呼叫 `xf86AllocateScreen()`，隨後以 `ms_setup_scrn_hooks()` 將自己的 `PreInit` 與 `ScreenInit` 寫入這筆 `ScrnInfoRec`。 以下片段來自 [`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:419`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L419-L435) 與 [`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:490`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L490-L517)：

```c
// [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:419-435]
static void
ms_setup_scrn_hooks(ScrnInfoPtr scrn)
{
    ...
    scrn->PreInit = PreInit;
    scrn->ScreenInit = ScreenInit;
    ...
}

// [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:490-517]
static Bool
ms_platform_probe(DriverPtr driver, int entity_num, int flags,
                  struct xf86_platform_device *dev, intptr_t match_data)
{
    ScrnInfoPtr scrn = NULL;
    ...
    if (probe_hw(path, dev)) {
        scrn = xf86AllocateScreen(driver, scr_flags);
        ...
        ms_setup_scrn_hooks(scrn);
        ...
    }
    return scrn != NULL;
}
```

##### DIX 建立 protocol-facing `ScreenRec`

在本文追蹤的 Xorg 原始程式碼中，一個 X Screen 具體對應到 Xorg 配置的一個 `ScreenRec` instance。 `ScreenRec` 是 X server 用來保存一個 X Screen 狀態的 C struct，其中會記錄 Screen 的編號、寬度、高度、可用的 depths／visuals、Root Window pointer，以及 Xorg 操作這個 Screen 時使用的 callbacks

每個 X Screen 都有一個稱為 Root Window 的特殊 X11 Window。 Root Window 涵蓋了該 Screen 的完整座標範圍，也是這棵 Window tree 的根節點。 由於本文只建立一個 X Screen，因此前面截圖中的整個桌面區域就是 X Screen 0 的座標範圍。 Xorg 會以 `screenInfo.screens[0]` 指向的 `ScreenRec` instance 保存這個 X Screen 的狀態

以下程式碼來自 [`Xorg: include/scrnintstr.h:512`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/scrnintstr.h#L512-L535)：

```c
// [Xorg: include/scrnintstr.h:512-535]
typedef struct _Screen {
    int myNum;
    ...
    short x, y, width, height;
    ...
    short numDepths;
    unsigned char rootDepth;
    DepthPtr allowedDepths;
    ...
    short numVisuals;
    VisualPtr visuals;
    WindowPtr root;
    ...
} ScreenRec;
```

`myNum` 是這個 X Screen 在 Xorg 內的編號，`width`／`height` 是 Screen 的寬度與高度，`x`／`y` 則是 Xorg 安排多個 Screens 時使用的內部 offset。 `allowedDepths` 列出可供 drawables 使用的 depths，`visuals` 則描述 pixel values 如何對應到 colors。 `root` 指向這個 X Screen 的 Root Window

Root Window 與其他 X11 Windows 在 Xorg 中都以 `WindowRec` 保存 server-side 狀態。 `ScreenRec::root` 是一個 `WindowPtr`，指向這個 X Screen 的 Root Window。 Window tree 的完整欄位與走訪方式會留到 `glxgears` 建立 application Window 時再看

Xorg 會使用一個全域 `ScreenInfo screenInfo` 登記 X server 內的所有 X Screens。 `numScreens` 記錄目前已建立的 X Screen 數量，`screens[i]` 則是一個 `ScreenPtr`，指向表示 X Screen `i` 的 `ScreenRec`。 以下程式碼來自 [`Xorg: include/scrnintstr.h:717`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/scrnintstr.h#L717-L734) 與 [`Xorg: dix/globals.c:65`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/globals.c#L65)：

```c
// [Xorg: include/scrnintstr.h:717-734]
typedef struct _ScreenInfo {
    ...
    int numScreens;
    ScreenPtr screens[MAXSCREENS];
    ...
} ScreenInfo;

extern ScreenInfo screenInfo;

// [Xorg: dix/globals.c:65]
ScreenInfo screenInfo;
```

##### `InitOutput()` 先探測 display device，再建立 `ScreenRec`

Xorg 啟動時，`dix_main()` 先將 `screenInfo.numScreens` 設為 0，再呼叫 `InitOutput()`

`InitOutput()` 前段會透過 `xf86BusConfig()` 探測 display device。 modesetting 的 probe callback 在這個階段呼叫 `xf86AllocateScreen()`，建立前面看到的 `ScrnInfoRec`

`InitOutput()` 完成 driver matching、`PreInit()` 與必要的驗證後，才在後段為每筆保留下來的 `ScrnInfoRec` 呼叫 `AddScreen(xf86ScreenInit, ...)`，建立相應的 `ScreenRec`

以下片段用來呈現同一次 `InitOutput()` 中前後兩個階段，來源如下：

- [`Xorg: dix/main.c:134`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/main.c#L134-L200)
- [`Xorg: hw/xfree86/common/xf86Init.c:280`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Init.c#L280-L282)
- [`Xorg: hw/xfree86/common/xf86Init.c:440`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Init.c#L440-L441)
- [`Xorg: hw/xfree86/common/xf86Init.c:625`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Init.c#L625-L647)

```c
// [Xorg: dix/main.c:134-135,185-196]
int
dix_main(int argc, char *argv[], char *envp[])
{
    ...
    screenInfo.numScreens = 0;
    ...
    InitOutput(argc, argv);

    if (screenInfo.numScreens < 1)
        FatalError("no screens found");
    ...
}

// [Xorg: hw/xfree86/common/xf86Init.c:279-282,440-441,625-647]
void
InitOutput(int argc, char **argv)
{
    int i, j, k, scr_index;
    ...
    if (xf86BusConfig(xf86Info.singleDriver) == FALSE)
        return;
    ...
    for (i = 0; i < xf86NumScreens; i++) {
        ...
        scr_index = AddScreen(xf86ScreenInit, argc, argv);
        ...
        if (scr_index == i) {
            dixSetPrivate(&screenInfo.screens[scr_index]->devPrivates,
                          xf86ScreenKey, xf86Screens[i]);
            xf86Screens[i]->pScreen = screenInfo.screens[scr_index];
            ...
        }
        ...
    }
}
```

[`Xorg: dix/dispatch.c:4076`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/dispatch.c#L4076-L4088) 的 `init_screen()` 會先將目前索引存進 `ScreenRec::myNum`。 [`Xorg: dix/dispatch.c:4131`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/dispatch.c#L4131-L4174) 的 `AddScreen()` 隨後將 `ScreenRec` pointer 登記到 `screenInfo.screens[i]`，再呼叫傳入的初始化函式：

```c
// [Xorg: dix/dispatch.c:4076-4088]
static int
init_screen(ScreenPtr pScreen, int i, Bool gpu)
{
    ...
    if (!dixAllocatePrivates(&pScreen->devPrivates, PRIVATE_SCREEN))
        return -1;
    pScreen->myNum = i;
    ...
}

// [Xorg: dix/dispatch.c:4130-4174]
int
AddScreen(Bool (*pfnInit)(ScreenPtr pScreen, int argc, char **argv),
          int argc, char **argv)
{
    int i;
    ScreenPtr pScreen;
    Bool ret;

    i = screenInfo.numScreens;
    ...
    pScreen = (ScreenPtr) calloc(1, sizeof(ScreenRec));
    if (!pScreen)
        return -1;

    ret = init_screen(pScreen, i, FALSE);
    if (ret != 0) {
        free(pScreen);
        return ret;
    }
    ...
    screenInfo.screens[i] = pScreen;
    screenInfo.numScreens++;
    if (!(*pfnInit)(pScreen, argc, argv)) {
        ...
        screenInfo.numScreens--;
        return -1;
    }
    ...
    return i;
}
```

第一次呼叫 `AddScreen()` 時，`numScreens` 是 0，因此 `init_screen()` 會將 `myNum` 設為 0，新的 `ScreenRec` 也會登記在 `screenInfo.screens[0]`。 下一次呼叫時，兩者的索引則是 1，依此類推

##### `ScrnInfoRec` 與 `ScreenRec` 如何互相連接

`InitOutput()` 傳給 `AddScreen()` 的初始化函式是 `xf86ScreenInit()`。 `AddScreen()` 呼叫它時，`ScreenRec::myNum` 已經設定完成，但 `InitOutput()` 還沒有將 `ScrnInfoRec *` 寫入 `ScreenRec::devPrivates`

第一次建立 X Screen 時，兩種記錄的連接必須先靠 `myNum` 與兩個陣列的共同索引完成

[`Xorg: hw/xfree86/common/xf86Helper.c:1618`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Helper.c#L1618-L1628) 的 `xf86ScreenToScrn()` 會讀取 `pScreen->myNum`，用它索引 `xf86Screens[]`。 [`Xorg: hw/xfree86/common/xf86Init.c:254`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/common/xf86Init.c#L254-L261) 的 `xf86ScreenInit()` 取得相應的 `ScrnInfoRec` 後，先讓 `pScrn->pScreen` 指向這筆 `ScreenRec`，再呼叫 modesetting 先前註冊的 `ScreenInit`：

```c
// [Xorg: hw/xfree86/common/xf86Helper.c:1618-1628]
ScrnInfoPtr
xf86ScreenToScrn(ScreenPtr pScreen)
{
    if (pScreen->isGPU) {
        ...
    } else {
        assert(pScreen->myNum < xf86NumScreens);
        return xf86Screens[pScreen->myNum];
    }
}

// [Xorg: hw/xfree86/common/xf86Init.c:254-261]
static Bool
xf86ScreenInit(ScreenPtr pScreen, int argc, char **argv)
{
    ScrnInfoPtr pScrn = xf86ScreenToScrn(pScreen);

    pScrn->pScreen = pScreen;
    return pScrn->ScreenInit(pScreen, argc, argv);
}
```

本節需要的包含關係與執行順序如下。 `InitOutput()` 是外層初始化函式，前段配置 `ScrnInfoRec`，後段再建立 `ScreenRec`：

```callgraph
[Xorg: dix/main.c:134] int dix_main(...)
  │
  │  [Xorg: dix/main.c:193]
  │  InitOutput(argc, argv)
  ↓
[Xorg: hw/xfree86/common/xf86Init.c:280] InitOutput()
  │
  ├─ display device probe 階段
  │    ↓
  │  [Xorg: hw/xfree86/common/xf86Init.c:440]
  │  if (xf86BusConfig(xf86Info.singleDriver) == FALSE)
  │    ↓
  │  [Xorg: hw/xfree86/common/xf86Bus.c:149] Bool xf86BusConfig(...)
  │    ↓
  │  [Xorg: hw/xfree86/common/xf86Bus.c:77] xf86CallDriverProbe()
  │    ↓
  │  [Xorg: hw/xfree86/common/xf86platformBus.c:576] xf86platformProbeDev()
  │    ↓
  │  [Xorg: hw/xfree86/common/xf86platformBus.c:534] probeSingleDevice()
  │    ↓
  │  [Xorg: hw/xfree86/common/xf86platformBus.c:488] doPlatformProbe()
  │    │
  │    │  drvp->platformProbe(...)
  │    │  // [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:121-139]
  │    │  // modesetting DriverRec 將 platformProbe 註冊成 ms_platform_probe
  │    ↓
  │  [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:491] ms_platform_probe()
  │    ├─ [Xorg: hw/xfree86/common/xf86Helper.c:158] xf86AllocateScreen(...)
  │    │    └─ xf86Screens[i] → ScrnInfoRec
  │    └─ [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:420]
  │         ms_setup_scrn_hooks(...)
  │         └─ pScrn->ScreenInit = ScreenInit
  │
  ├─ [Xorg: hw/xfree86/common/xf86Init.c:469-479]
  │  完成 driver matching、PreInit() 與必要驗證
  │
  └─ 建立 DIX X Screen 的階段
       ↓
     [Xorg: hw/xfree86/common/xf86Init.c:625] for each xf86Screens[i]
       │
       │  AddScreen(xf86ScreenInit, ...)
       ↓
     [Xorg: dix/dispatch.c:4131] AddScreen()
       ├─ 配置 ScreenRec
       ├─ pScreen->myNum = i
       └─ screenInfo.screens[i] = pScreen
       ↓
     [Xorg: hw/xfree86/common/xf86Init.c:255] xf86ScreenInit()
       ├─ pScrn = xf86Screens[pScreen->myNum]
       └─ pScrn->pScreen = pScreen
       ↓
     pScrn->ScreenInit(...)
       │
       │  callback 由 modesetting driver 註冊
       ↓
     [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1995] ScreenInit()
       ↓
     callback 成功回傳，AddScreen() 才將索引傳回 InitOutput()
       ↓
     [Xorg: hw/xfree86/common/xf86Init.c:637-647] InitOutput()
       ├─ dixSetPrivate(..., xf86Screens[i])
       └─ xf86Screens[i]->pScreen = screenInfo.screens[i]
```

兩種記錄在這裡各自保存不同層次的狀態：

- `xf86Screens[i]` 指向 `ScrnInfoRec`，保存 XFree86 DDX 的 driver-facing 組態與 callbacks
- `screenInfo.screens[i]` 指向 `ScreenRec`，保存 DIX 的 protocol-facing X Screen runtime state
- `ScrnInfoRec::pScreen` 在初始化時指向相應的 `ScreenRec`

將 `ScrnInfoRec *` 寫入 `ScreenRec::devPrivates` 的動作發生得更晚。 modesetting `ScreenInit()` 成功回傳後，`AddScreen()` 才回傳索引，`InitOutput()` 隨後執行 `dixSetPrivate()`，並再次確認 `ScrnInfoRec::pScreen` 指向 `screenInfo.screens[scr_index]`。 初次 `xf86ScreenInit()` 因此不能依賴這筆私有資料，而是以已設定的 `ScreenRec::myNum` 索引 `xf86Screens[]`

#### modesetting `ScreenInit()` 建立 front BO 與 dumb-buffer storage

使用者還在等桌面出現。 Xorg 已建立 `ScreenRec`，但這個 X Screen 仍需要一份能保存完整畫面的 pixel storage。 現在正式引入 front BO：modesetting driver 的 `drmmode_rec::front_bo` 是一個 `struct gbm_bo *`，指向 `libgbm` 在 Xorg 行程中建立的 scanout-capable GBM object

這個 GBM object 會包裝 kernel dumb BO，而 screen Pixmap 稍後會指向它的 CPU mapping。 `struct gbm_bo`、screen Pixmap、kernel buffer object 與 KMS framebuffer 分屬不同層級，但會透過 mapping 或 reference 接到同一份 pixel storage。 `ScreenInit()` 會先建立 front BO 並取得 CPU virtual address，接著讓 screen Pixmap 指向這份 mapping

[`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1994`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L1994-L2025) 的完整函式簽名與初始 BO call site 如下：

```c
// [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1994-2025]
static Bool
ScreenInit(ScreenPtr pScreen, int argc, char **argv)
{
    ScrnInfoPtr pScrn = xf86ScreenToScrn(pScreen);
    modesettingPtr ms = modesettingPTR(pScrn);
    ...
    if (!drmmode_create_initial_bos(pScrn, &ms->drmmode))
        return FALSE;
    ...
}
```

DRI 的全名是 Direct Rendering Infrastructure，是一組銜接 Mesa loader、rendering driver 與 window system 的介面。 `libgbm` 的 DRI backend 位於 `src/gbm/backends/dri/`，負責將單次 GBM buffer 建立要求交給可用的 driver path。 本例的 usage flags 會讓它改走 `create_dumb()`，向 DRM 建立基礎線性 buffer

Xorg 的 `gbm_bo_create_and_map_with_flag_list()` 會依序嘗試多組 usage flags，每一個 candidate 都會呼叫 Mesa `libgbm` 提供的 GBM 公開 API。 當 Xorg 嘗試 `GBM_BO_USE_WRITE | GBM_BO_USE_SCANOUT` 時，`libgbm` 會將這一次建立要求分派給 DRI backend，再進入 `create_dumb()`。 本節固定追蹤這條 fallback 分支，藉此觀察 Xorg、Mesa GBM、DRM core 與 Linux `virtio_gpu` driver 各自負責的一段

`drmIoctl()` 雖位於 Mesa `libgbm` 原始程式碼，執行者仍是載入它的 Xorg 行程。 DRM core 解析 `CREATE_DUMB` 後，透過 `drm_driver::dumb_create` 進入 virtio-gpu 實作

下圖的 Xorg helpers 可對照 [`Xorg: drmmode_display.c:4838`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/drmmode_display.c#L4838-L4856) 與 [`Xorg: drmmode_bo.c:142`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/drmmode_bo.c#L142-L298)

GBM 公開入口與 DRI backend 分別來自 [`Mesa: gbm.c:489`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm.c#L489-L501) 與 [`Mesa: gbm_dri.c:828`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L828-L903)

Kernel 內的 ioctl 可對照 [`Linux: drm_dumb_buffers.c:194`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/gpu/drm/drm_dumb_buffers.c?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n194)

virtio-gpu create path 可對照 [`Linux: virtgpu_gem.c:30`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/gpu/drm/virtio/virtgpu_gem.c?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n30) 與 [`Linux: virtgpu_object.c:203`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/gpu/drm/virtio/virtgpu_object.c?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n203)

```callgraph
Xorg modesetting：請求建立可 mapping 的 front BO
=================================================
[Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1994]
static Bool
ScreenInit(ScreenPtr pScreen, int argc, char **argv)
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_display.c:4838]
Bool drmmode_create_initial_bos(ScrnInfoPtr pScrn,
                                drmmode_ptr drmmode)
  │
  │  width = pScrn->virtualX;
  │  height = pScrn->virtualY;
  │  drmmode->front_bo = gbm_create_best_bo(
  │      drmmode, !drmmode->glamor, width, height, DRMMODE_FRONT_BO);
  │  // 無 glamor 組態要求建立可供 CPU mapping 的 front BO
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:272]
struct gbm_bo *
gbm_create_best_bo(drmmode_ptr drmmode, Bool do_map,
                   uint32_t width, uint32_t height, int type)
  │
  │  type == DRMMODE_FRONT_BO
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:196]
static inline struct gbm_bo *
gbm_create_front_bo(drmmode_ptr drmmode, Bool do_map,
                    bo_priv_t *data,
                    unsigned width, unsigned height)
  │
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:174]
static inline struct gbm_bo *
gbm_bo_create_and_map_with_flag_list(
    struct gbm_device *gbm, bo_priv_t *data, Bool do_map,
    uint32_t width, uint32_t height, uint32_t format,
    const uint64_t *modifiers, const unsigned int count,
    const uint32_t *flag_list, unsigned int flag_count)
  │
  │  依序嘗試 front_flag_list，本文追蹤的 dumb BO candidate 是：
  │  GBM_BO_USE_WRITE | GBM_BO_USE_SCANOUT
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:142]
static inline struct gbm_bo *
gbm_bo_create_and_map(
    struct gbm_device *gbm, bo_priv_t *data, Bool do_map,
    uint32_t width, uint32_t height, uint32_t format,
    const uint64_t *modifiers, const unsigned int count,
    uint32_t flags)
  │
  └─ TRY_CREATE(gbm_bo_create, data, do_map,
                gbm, width, height, format, flags)
       ↓

Mesa libgbm 公開 API：分派到 backend callback
=================================================
[Mesa: src/gbm/main/gbm.c:489]
GBM_EXPORT struct gbm_bo *
gbm_bo_create(struct gbm_device *gbm,
              uint32_t width, uint32_t height,
              uint32_t format, uint32_t flags)
  │
  └─ gbm->v0.bo_create(gbm, width, height, format,
                       flags, NULL, 0)
       ↓

Mesa libgbm DRI backend：建立 dumb BO
=================================================
[Mesa: src/gbm/backends/dri/gbm_dri.c:886]
static struct gbm_bo *
gbm_dri_bo_create(struct gbm_device *gbm,
                  uint32_t width, uint32_t height,
                  uint32_t format, uint32_t usage,
                  const uint64_t *modifiers,
                  const unsigned int count)
  │
  │  if (usage & GBM_BO_USE_WRITE || !dri->has_dmabuf_export)
  └─     return create_dumb(gbm, width, height, format, usage);
       ↓
[Mesa: src/gbm/backends/dri/gbm_dri.c:828]
static struct gbm_bo *
create_dumb(struct gbm_device *gbm,
            uint32_t width, uint32_t height,
            uint32_t format, uint32_t usage)
  │
  │  create_arg.bpp = 32;
  │  create_arg.width = width;
  │  create_arg.height = height;
  │
  ├─ drmIoctl(dri->base.v0.fd,
  │             DRM_IOCTL_MODE_CREATE_DUMB, &create_arg)
  │      // fd 對應 Xorg 開啟的 DRM primary node
  │
  ├─ bo->base.v0.stride = create_arg.pitch
  ├─ bo->base.v0.handle.u32 = create_arg.handle
  └─ gbm_dri_bo_map_dumb(bo)
       ↓

Linux DRM core：從 ioctl 分派到 driver callback
=================================================
[Linux: drivers/gpu/drm/drm_ioctl.c:696]
DRM_IOCTL_MODE_CREATE_DUMB
  ↓
[Linux: drivers/gpu/drm/drm_dumb_buffers.c:233]
int drm_mode_create_dumb_ioctl(struct drm_device *dev,
                               void *data,
                               struct drm_file *file_priv)
  │
  └─ drm_mode_create_dumb(dev, args, file_priv)
       │
       └─ dev->driver->dumb_create(file_priv, dev, args)
            │  // virtio_gpu driver 註冊 virtio_gpu_mode_dumb_create
            ↓

Linux virtio-gpu 2D：建立 GEM object 與 virtio resource
=================================================
[Linux: drivers/gpu/drm/virtio/virtgpu_gem.c:61]
int virtio_gpu_mode_dumb_create(struct drm_file *file_priv,
                                struct drm_device *dev,
                                struct drm_mode_create_dumb *args)
  │
  ├─ pitch = args->width * 4
  ├─ params.dumb = true
  └─ virtio_gpu_gem_create(..., &args->handle)
       ↓
[Linux: drivers/gpu/drm/virtio/virtgpu_gem.c:30]
static int virtio_gpu_gem_create(
    struct drm_file *file, struct drm_device *dev,
    struct virtio_gpu_object_params *params,
    struct drm_gem_object **obj_p, uint32_t *handle_p)
  │
  │  內部 create path 先配置 object，再建立此 DRM file 的 GEM handle
  └─ virtio_gpu_object_create(vgdev, params, &obj, NULL)
       ↓
[Linux: drivers/gpu/drm/virtio/virtgpu_object.c:203]
int virtio_gpu_object_create(
    struct virtio_gpu_device *vgdev,
    struct virtio_gpu_object_params *params,
    struct virtio_gpu_object **bo_ptr,
    struct virtio_gpu_fence *fence)
  │
  ├─ drm_gem_shmem_create(...)
  ├─ virtio_gpu_resource_id_get(..., &bo->hw_res_handle)
  ├─ virtio_gpu_object_shmem_init(..., &ents, &nents)
  │
  └─ 本文固定的 no-blob、no-VirGL 分支：
       ├─ virtio_gpu_cmd_create_resource(...)
       │    └─ VIRTIO_GPU_CMD_RESOURCE_CREATE_2D
       └─ virtio_gpu_object_attach(...)
            └─ VIRTIO_GPU_CMD_RESOURCE_ATTACH_BACKING
```

`CREATE_DUMB` 成功後回傳的 `handle`、`pitch` 與 `size` 有不同用途。 `handle` 讓這個 DRM file 可以繼續引用 GEM object，`pitch` 表示每列 pixels 佔用的 bytes，`size` 則是實際配置大小。 GBM 將這些結果收進 `struct gbm_bo`，Xorg 之後只透過 GBM API 查詢它們

Linux `virtio_gpu` driver 在同一次建立中配置 GEM shmem backing，另外取得 `hw_res_handle`。 `virtio_gpu_cmd_create_resource()` 將 `RESOURCE_CREATE_2D` 排入 control virtqueue，要求 host device 建立可由 resource ID 引用的 2D resource。 `virtio_gpu_object_attach()` 接著排入 `RESOURCE_ATTACH_BACKING`，要求 host 將 guest pages 接給這個 resource

`ScreenInit()` 還會登記兩個 callbacks，來源分別位於 [`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:2089`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L2089) 與 [`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:2136`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L2136-L2137)

第一個 callback 將 `pScreen->CreateScreenResources` 登記為 `modesetCreateScreenResources()`，第二個則把 `pScreen->BlockHandler` 換成 `msBlockHandler_oneshot()`。 這裡只登記 callbacks，尚未執行第一次 `ADDFB` 或 `SETCRTC`

到這裡為止，guest 已配置 storage 與 resource identity，並送出建立 host resource 的 requests，但 KMS 還沒有將它選為 scanout source

#### Xorg 將 X Screen 資料準備成 connection setup reply

使用者此刻仍在等待，Xorg 要先準備第一條 client connection 所需的共同資料。 由於 Xorg 與 X11 client 位於不同的行程，application 不能直接讀取 Xorg 行程裡的 `ScreenRec`。 Xorg 會將 client 需要的 server-wide 資料與各個 X Screen 的資料序列化至一段名為 `ConnectionInfo` 的連續 byte buffer，作為 connection setup reply 的共同內容

`ScreenInit()` 回傳後，DIX 會建立 screen resources 與 Root Windows，再初始化輸入裝置。 Primary screen 的 `modesetCreateScreenResources()` 會以 `pScrn->is_gpu == FALSE` 呼叫 `drmmode_set_desired_modes(..., FALSE, FALSE)`，此時只建立 software desired state，不會提交 hardware modeset。 Xorg 接著呼叫 `CreateConnectionBlock()`，將各個 X Screen 的資料依序編碼進 buffer

以下程式碼來自 [`Xorg: dix/main.c:134`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/main.c#L134-L288)，用來確認 `CreateConnectionBlock()` 與 `Dispatch()` 的執行順序：

```c
// [Xorg: dix/main.c:134-135,211-288]
int
dix_main(int argc, char *argv[], char *envp[])
{
    ...
    DIX_FOR_EACH_SCREEN({
        if (!dixScreenRaiseCreateResources(walkScreen))
            FatalError("failed to create screen resources");
    });
    ...
    DIX_FOR_EACH_SCREEN({
        InitRootWindow(walkScreen->root);
        CallCallbacks(&PostInitRootWindowCallback, walkScreen);
    });
    ...
    InitCoreDevices();
    InitInput(argc, argv);
    InitAndStartDevices();
    ...
    if (!CreateConnectionBlock())
        FatalError("could not create connection block info");
    ...
    NotifyParentProcess();
    ...
    Dispatch();
    ...
}
```

其中的 `DIX_FOR_EACH_SCREEN()` 與 `CreateConnectionBlock()` 分別來自 [`Xorg: dix/screenint_priv.h:66`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/screenint_priv.h#L66-L73) 與 [`Xorg: dix/dispatch.c:603`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/dispatch.c#L603-L727)。 第一段定義了走訪 X Screens 的順序，第二段則依該順序寫入 `xWindowRoot`、`xDepth` 與 `xVisualType`：

```c
// [Xorg: dix/screenint_priv.h:66-73]
#define DIX_FOR_EACH_SCREEN(__LAMBDA__) \
    do { \
        for (unsigned walkScreenIdx = 0; \
             walkScreenIdx < screenInfo.numScreens; \
             walkScreenIdx++) { \
            ScreenPtr walkScreen = screenInfo.screens[walkScreenIdx]; \
            ... \
            __LAMBDA__; \
        } \
    } while (0);

...

// [Xorg: dix/dispatch.c:603-727]
Bool
CreateConnectionBlock(void)
{
    xConnSetup setup;
    xWindowRoot root;
    xDepth depth;
    xVisualType visual;
    unsigned long vid;
    char *pBuf;
    ...

    setup.numRoots = screenInfo.numScreens;
    ...

    DIX_FOR_EACH_SCREEN({
        DepthPtr pDepth;
        VisualPtr pVisual;
        ...
        root.windowId = walkScreen->root->drawable.id;
        root.defaultColormap = walkScreen->defColormap;
        root.whitePixel = walkScreen->whitePixel;
        root.blackPixel = walkScreen->blackPixel;
        root.pixWidth = walkScreen->width;
        root.pixHeight = walkScreen->height;
        root.mmWidth = walkScreen->mmWidth;
        root.mmHeight = walkScreen->mmHeight;
        root.rootVisualID = walkScreen->rootVisual;
        root.rootDepth = walkScreen->rootDepth;
        root.nDepths = walkScreen->numDepths;
        memcpy(pBuf, &root, sizeof(xWindowRoot));
        pBuf += sizeof(xWindowRoot);
        ...

        pDepth = walkScreen->allowedDepths;
        for (int j = 0; j < walkScreen->numDepths; j++, pDepth++) {
            ...
            depth.depth = pDepth->depth;
            depth.nVisuals = pDepth->numVids;
            memcpy(pBuf, &depth, sizeof(xDepth));
            pBuf += sizeof(xDepth);
            ...

            for (int k = 0; k < pDepth->numVids; k++) {
                vid = pDepth->vids[k];
                for (pVisual = walkScreen->visuals;
                     pVisual->vid != vid; pVisual++);
                visual.visualID = vid;
                visual.class = pVisual->class;
                visual.bitsPerRGB = pVisual->bitsPerRGBValue;
                visual.colormapEntries = pVisual->ColormapEntries;
                visual.redMask = pVisual->redMask;
                visual.greenMask = pVisual->greenMask;
                visual.blueMask = pVisual->blueMask;
                memcpy(pBuf, &visual, sizeof(xVisualType));
                pBuf += sizeof(xVisualType);
                ...
            }
        }
    });
    ...
}
```

`DIX_FOR_EACH_SCREEN` 讓 `walkScreenIdx` 從 0 開始遞增，並在每一輪取得 `screenInfo.screens[walkScreenIdx]`。 因此第一輪處理 Screen 0，第二輪處理 Screen 1，依此類推

`CreateConnectionBlock()` 會將 X Screen 數量寫入 `setup.numRoots`。 每次 `memcpy()` 寫入一筆資料後，`pBuf` 會繼續指向下一個寫入位置。 每一輪會先寫入目前 Screen 的 `xWindowRoot`，再接著寫入它的 `xDepth` 與 `xVisualType` records，下一輪才開始寫入下一個 Screen

`xWindowRoot` 內保存了 Root Window XID、Screen 尺寸、預設 root depth 與 root visual 等資料。 後續的 `xDepth` 與 `xVisualType` records 則列出了該 Screen 可用的 depths 與 visuals。 `numRoots` 會等於 X Screens 的數量，因為每個 X Screen 都有一個 Root Window

因此結合 `dix_main()` 的內容可知，`CreateConnectionBlock()` 會在 `Dispatch()` 前先執行一次，按照 `screenInfo.screens[]` 既有的順序，將各個 X Screen 序列化至 `ConnectionInfo`。 Connection block 依賴的是已完成的 `ScreenRec`、Root Window、depths 與 visuals，不需要等待 active scanout，因此它早於第一次 `ADDFB` 與 `SETCRTC`

接著 `NotifyParentProcess()` 以 SIGUSR1 喚醒 `xinit`。 這時共同 setup buffer 已存在，但 `waitforserver()` 尚未成功。 Xorg 還要進入 `Dispatch()`，讓 event loop 完成 initial scanout 並實際處理 `XOpenDisplay()` 的 connection 與 setup exchange

#### Xorg 進入 `Dispatch()`：one-shot BlockHandler 建立 initial scanout

SIGUSR1 已喚醒 `xinit`，但使用者仍看不到桌面 clients，`waitforserver()` 也還在嘗試連線。 Xorg 此刻要把 front BO 包成 KMS framebuffer，並綁進 kernel probe 已建立的 plane、CRTC、encoder 與 connector topology

`ScreenInit()` 登記的 `modesetCreateScreenResources()` 已在 DIX 建立 screen resources 時執行。 對本文的 primary screen 而言，`pScrn->is_gpu` 是 `FALSE`，因此 [`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1722`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L1722-L1733) 呼叫 `drmmode_set_desired_modes(..., FALSE, FALSE)` 時只形成 software desired state，不會提交 actual hardware modeset

第一次真正的 modeset 位於 `Dispatch()` 的第一輪 BlockHandler。 以下呼叫順序來自 [`Xorg: dix/dispatch.c:479`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/dispatch.c#L479-L498)、[`Xorg: os/WaitFor.c:168`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/os/WaitFor.c#L168-L207) 與 [`Xorg: hw/xfree86/drivers/video/modesetting/driver.c:949`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L949-L958)：

```callgraph
[Xorg: dix/dispatch.c:479]
void Dispatch(void)
  ↓
[Xorg: dix/dispatch.c:497]
WaitForSomething(clients_are_ready())
  ↓
[Xorg: os/WaitFor.c:168]
Bool WaitForSomething(Bool are_ready)
  │
  ├─ ProcessWorkQueue()
  ├─ BlockHandler(&timeout)
  │    ↓
  │  [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:949]
  │  static void
  │  msBlockHandler_oneshot(ScreenPtr pScreen, void *pTimeout)
  │    ├─ msBlockHandler(pScreen, pTimeout)
  │    └─ drmmode_set_desired_modes(pScrn, &ms->drmmode,
  │                                  TRUE, FALSE)
  │
  └─ ospoll_wait(server_poll, timeout)
```

`drmmode_set_desired_modes(..., TRUE, FALSE)` 第一次需要 `fb_id` 時，`drmmode_bo_import()` 會以 `drmModeAddFB()` 建立 KMS framebuffer。 本文的 Xorg 設定沒有啟用 `Option "Atomic"`，因此 userspace 接著以 legacy `drmModeSetCrtc()` 提交 CRTC、connector 與 mode state。 Linux `virtio_gpu` 使用 atomic KMS helpers，DRM core 會將 legacy request 轉成 kernel atomic state 再提交

```callgraph
Xorg modesetting：建立 KMS framebuffer
=================================================
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:341]
int drmmode_bo_import(drmmode_ptr drmmode,
                      struct gbm_bo *bo,
                      uint32_t *fb_id)
  │
  └─ 本文的 linear dumb BO 分支：
       drmModeAddFB(drmmode->fd, width, height,
                    depth, bpp, stride, handle, fb_id)
       │
       │  // libdrm 將 BO handle 與 layout 送入 DRM_IOCTL_MODE_ADDFB
       ↓

Linux DRM/KMS：將 BO 包成 framebuffer object
=================================================
[Linux: drivers/gpu/drm/drm_framebuffer.c:118]
int drm_mode_addfb(struct drm_device *dev,
                   struct drm_mode_fb_cmd *request,
                   struct drm_file *file_priv)
  │
  ├─ 將 legacy depth／bpp／pitch／handle 轉成 drm_mode_fb_cmd2
  └─ drm_mode_addfb2(dev, &request2, file_priv)
       ↓
[Linux: drivers/gpu/drm/drm_framebuffer.c:259]
drm_internal_framebuffer_create(...)
  │
  └─ dev->mode_config.funcs->fb_create(...)
       │  // virtio_gpu_mode_funcs.fb_create
       ↓
[Linux: drivers/gpu/drm/virtio/virtgpu_display.c:318]
virtio_gpu_user_framebuffer_create(...)
  │
  ├─ drm_gem_object_lookup(file_priv, mode_cmd->handles[0])
  └─ virtio_gpu_framebuffer_init(dev, virtio_gpu_fb,
                                  info, mode_cmd, obj)
       ↓
[Linux: drivers/gpu/drm/virtio/virtgpu_display.c:70]
virtio_gpu_framebuffer_init(...)
  ├─ vgfb->base.obj[0] = obj
  ├─ drm_helper_mode_fill_fb_struct(...)
  └─ drm_framebuffer_init(..., &virtio_gpu_fb_funcs)
       │
       │  // fb_id 現在可以穩定引用這份 GEM storage
       ↓

Xorg modesetting：設定 CRTC 與 display mode
=================================================
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_display.c:845]
static int drmmode_crtc_set_mode(xf86CrtcPtr crtc, Bool test_only)
  │
  │  fb_id = front BO 對應的 KMS framebuffer
  │  output_ids[] = 要接上的 connectors
  └─ drmModeSetCrtc(fd, crtc_id, fb_id,
                    x, y, output_ids, output_count, &mode)
       │
       │  // libdrm 送出 DRM_IOCTL_MODE_SETCRTC
       ↓

Linux DRM/KMS：legacy request 轉成 atomic commit
=================================================
[Linux: drivers/gpu/drm/drm_crtc.c:709]
int drm_mode_setcrtc(struct drm_device *dev,
                     void *data,
                     struct drm_file *file_priv)
  │
  ├─ 依 crtc_id、fb_id 與 connector IDs 找回 KMS objects
  ├─ set = { .crtc, .fb, .mode, .connectors, .x, .y }
  ├─ if (!drm_drv_uses_atomic_modeset(dev))
  │    └─ __drm_mode_set_config_internal(&set, &ctx)
  └─ 本例的 atomic KMS 分支
       └─ crtc->funcs->set_config(&set, &ctx)
            │  // virtio_gpu_crtc_funcs.set_config
            │  //     = drm_atomic_helper_set_config
            ↓

[Linux: drivers/gpu/drm/drm_atomic_helper.c:3503]
int drm_atomic_helper_set_config(struct drm_mode_set *set,
                                 struct drm_modeset_acquire_ctx *ctx)
  ├─ state = drm_atomic_commit_alloc(...)
  ├─ __drm_atomic_helper_set_config(set, state)
  └─ drm_atomic_commit(state)
       ↓
[Linux: drivers/gpu/drm/drm_atomic.c:1774]
int drm_atomic_commit(struct drm_atomic_commit *state)
  ├─ drm_atomic_check_only(state)
  │    └─ validation 失敗：回傳錯誤，不進入 commit tail
  └─ validation 成功：
       state->dev->mode_config.funcs->atomic_commit(...)
       │  // virtio_gpu_mode_funcs.atomic_commit = drm_atomic_helper_commit
       ↓
[Linux: drivers/gpu/drm/drm_atomic_helper.c:2245]
int drm_atomic_helper_commit(...)
  ├─ drm_atomic_helper_prepare_planes(...)
  ├─ drm_atomic_helper_swap_state(...)
  └─ commit_tail(state)
       └─ drm_atomic_helper_commit_tail(state)
            ↓
[Linux: drivers/gpu/drm/drm_atomic_helper.c:2972]
drm_atomic_helper_commit_planes(...)
  └─ funcs->atomic_update(plane, state)
       │  // primary plane helper 註冊 virtio_gpu_primary_plane_update
       ↓
[Linux: drivers/gpu/drm/virtio/virtgpu_plane.c:235]
virtio_gpu_primary_plane_update(...)
  ├─ framebuffer 不存在或 CRTC 未 active
  │    └─ SET_SCANOUT(resource_id = 0) 後結束
  ├─ 沒有有效 damage
  │    └─ 結束這次 plane update
  ├─ dumb BO：TRANSFER_TO_HOST_2D
  ├─ framebuffer／source／modeset 變更：SET_SCANOUT
  └─ 有效 damage update：RESOURCE_FLUSH
```

KMS framebuffer 保存 GEM object reference 與 scanout layout，pixels 繼續留在原本的 front BO storage。 初次 modeset 時，primary plane 從沒有 framebuffer 變成引用 front BO 對應的 framebuffer，因此 `virtio_gpu_primary_plane_update()` 會發出 initial `SET_SCANOUT`，將 virtio resource ID、virtual scanout ID 與 source rectangle 綁在一起

這一輪只把 framebuffer 綁進 kernel 已建立的 display topology。 `ADDFB`、`SETCRTC` 與 initial `SET_SCANOUT` 都是 display state 的初始建立或變更，不是每幀固定重做。 後續只有 BO／framebuffer、mode、source rectangle 或 scanout binding 改變時，才可能再次走這些操作

完成 one-shot BlockHandler 後，`WaitForSomething()` 才進入 poll。 Xorg event loop 隨後接受 `xinit` 的 connection 並傳回 setup reply，`waitforserver()` 的 `XOpenDisplay(displayNum)` 因而成功，`startServer()` 回傳，`xinit` 才會繼續執行 `startClient()`

Xorg 的 modesetting 主線至此已完成

### Xorg ready 後，第一批 clients 如何建立 X11 session

Xorg 準備好 connection setup 資料並建立 initial scanout 後，`xinit` 才執行 `xinitrc`。 第一批桌面 clients 各自連入同一個 Xorg，libX11 再把 setup reply 轉成每條 connection 專屬的 `Display` 與 `Screen[]`。 `twm` 完成這些共同步驟後，才會取得 window manager 角色

#### Xorg 就緒後：`xinitrc` 啟動 `twm`、`xclock` 與 `xterm`

`waitforserver()` 已完成 setup connection，使用者接下來會看到桌面 clients 陸續出現。 Xorg 此刻要處理第一批 client connections，而 `xinit` 的 `main()` 才跨過 `startServer(server) > 0`，呼叫 [`xinit: xinit.c:560`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/xinit.c#L560-582) 的 `startClient()`，執行先前選定的 system `xinitrc`

```callgraph
waitforserver() 的 XOpenDisplay(displayNum) 成功
  ↓
startServer(server) 回傳成功
  ↓
[xinit: xinit.c:294]
if (startServer(server) > 0 && startClient(client) > 0) { ... }
  ↓
[xinit: xinit.c:560]
static pid_t startClient(char *client_argv[])
  │
  │  fork()
  ├─ client child：Execute(client_argv)
  │    // client_argv 指向 system xinitrc
  ↓
[xinit: xinitrc.cpp:51]
  ├─ twm &
  ├─ xclock ... &
  ├─ xterm ... &
  └─ exec xterm ...
       // build 後的實際命令名稱
       // 由 TWM／XCLOCK／XTERM 展開而來
```

[`xinit: xinitrc.cpp:51`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/xinitrc.cpp#L51-55) 裡的 `TWM`、`XCLOCK` 與 `XTERM` 是 build-time tokens，會在 build 時對應到本文組態選入的 `twm`、`xclock` 與 `xterm`。 `&` 讓 shell 不等待前一個程式結束，因此 script 中的啟動順序不代表 clients 完成 X11 connection 的順序

`twm`、`xclock` 與 `xterm` 是彼此獨立的行程，各自建立一條 X11 connection。 連線後建立的 client-side objects 留到下一節說明

使用者等桌面出現並可操作後，才會從 `xterm` 啟動 `glxgears`。 另一種 session 啟動方式是由 GDM、LightDM、SDDM 這類 display manager 提供圖形登入、驗證帳號、啟動 Xorg 與 session 程式。 這些啟動方式雖然不同，各個 X11 clients 在 session 中仍會分別建立自己的 connection

#### 第一批 X11 clients 連到 Xorg：libX11 建立 `Display` 與 `Screen[]`

System `xinitrc` 已啟動第一批桌面 clients。 故事中的第一個具體 client 是 `twm`：它在 `main()` 呼叫 `XtOpenDisplay()`，經 Xt 與 Xlib 建立自己的 X11 connection。 `xclock` 與 `xterm` 也會各自建立 connection，但 shell 的啟動順序不保證哪一條先完成 setup

Xt 底下仍由 libX11 處理 connection setup。 以下沿 libX11 `XOpenDisplay()` 的內部工作，追蹤 setup reply 如何成為 `Display` 與 `Screen[]`。 使用者稍後從 `xterm` 啟動 `glxgears` 時，會另外呼叫 `XOpenDisplay()` 建立另一條 connection，重複相同的 setup。 其 call site 留到 application Window 與 OpenGL context 出場時再看

`XtOpenDisplay()` 成功後，`twm` 取得的 `dpy` 型態是 `Display *`。 `twm` 透過這個 pointer 使用 libX11 建立的 client-side object。 這個 object 保存一條 X server connection 的狀態，以及 connection setup 時取得的 server 與 X Screens 資料。 每次成功開啟一條 connection 時，都會建立新的 `Display` instance

libX11 的公開 header 將 `Display` 宣告成 opaque type，application 只使用 `Display *`，不直接依賴 struct layout。 libX11 內部的 `_XDisplay` 則會保存 connection 與 Screens。 以下程式碼來自 [`libX11: include/X11/Xlib.h:481`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/include/X11/Xlib.h#L481-L488) 與 [`libX11: include/X11/Xlibint.h:72`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/include/X11/Xlibint.h#L72-L120)：

```c
// [libX11: include/X11/Xlib.h:481-488]
typedef struct _XDisplay Display;

// [libX11: include/X11/Xlibint.h:72-120]
struct _XDisplay
{
    ...
    int fd;
    ...
    char *display_name;
    int default_screen;
    int nscreens;
    Screen *screens;
    ...
};
```

`fd` 是底層 transport connection 的 file descriptor，`display_name` 保存這條 connection 使用的 display name。 `default_screen` 保存一個 X Screen 編號，指出這條 connection 預設使用哪一個 X Screen。 `nscreens` 記錄 Xorg 回報的 X Screen 數量，`screens` 則指向 libX11 接下來要建立的 `Screen` array

每個 `Screen` element 都保存著一個 X Screen 的 client-side 資料。 `display` 會回頭指向擁有這個 array 的 `Display`，`root` 保存 Root Window XID，其他欄位則保存尺寸、depths、visual 與預設的 colormap。 以下程式碼來自 [`libX11: include/X11/Xlib.h:249`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/include/X11/Xlib.h#L249-L275)：

```c
// [libX11: include/X11/Xlib.h:249-275]
typedef struct {
    ...
    struct _XDisplay *display;
    Window root;
    int width, height;
    int mwidth, mheight;
    int ndepths;
    Depth *depths;
    int root_depth;
    Visual *root_visual;
    ...
    Colormap cmap;
    ...
} Screen;
```

`XOpenDisplay()` 會先配置 `Display`，再建立底層 connection。 取得 Xorg 的 setup reply 後，它會將 `numRoots` 保存成 `dpy->nscreens`，配置相同數量的 `Screen` elements，再將每筆 `xWindowRoot` 與其後的 depth／visual records 轉成一個 `Screen`

以下程式碼來自 [`libX11: src/OpenDis.c:63`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/src/OpenDis.c#L63-L132)、[`libX11: src/OpenDis.c:194`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/src/OpenDis.c#L194-L205)、[`libX11: src/OpenDis.c:258`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/src/OpenDis.c#L258-L295) 與 [`libX11: src/OpenDis.c:372`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/src/OpenDis.c#L372-L480)：

```c
// [libX11: src/OpenDis.c:63-132,194-205,258-295,372-480]
Display *
XOpenDisplay(register _Xconst char *display)
{
    register Display *dpy;
    register int i;
    int j, k;
    int iscreen;
    union {
        xConnSetup *setup;
        ...
        xWindowRoot *rp;
        xDepth *dp;
        xVisualType *vp;
    } u;
    ...

    if ((dpy = Xcalloc(1, sizeof(Display))) == NULL) {
        return(NULL);
    }
    ...
    if (!_XConnectXCB(dpy, display, &iscreen)) {
        OutOfMemory(dpy);
        return NULL;
    }
    ...
    dpy->default_screen = iscreen;
    ...
    dpy->nscreens = u.setup->numRoots;
    ...

    dpy->screens = Xcalloc(dpy->nscreens, sizeof(Screen));
    ...
    for (i = 0; i < dpy->nscreens; i++) {
        register Screen *sp = &dpy->screens[i];
        ...
        sp->display = dpy;
        sp->root = u.rp->windowId;
        sp->cmap = u.rp->defaultColormap;
        sp->width = u.rp->pixWidth;
        sp->height = u.rp->pixHeight;
        sp->root_depth = u.rp->rootDepth;
        sp->ndepths = u.rp->nDepths;
        u.rp = (xWindowRoot *) (((char *) u.rp) + sz_xWindowRoot);
        ...

        sp->depths = Xcalloc(sp->ndepths, sizeof(Depth));
        for (j = 0; j < sp->ndepths; j++) {
            ...
            // 依序把目前 X Screen 的 xDepth 與 xVisualType records
            // 轉成 client-side Depth 與 Visual objects。
        }
        ...
    }
    ...
    return(dpy);
}
```

[`libX11: src/xcb_disp.c:57`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/src/xcb_disp.c#L57-L84) 的 `_XConnectXCB()` 會解析 display name 中的 X Screen 編號，將該編號對應的 X Screen 選為這條 `Display` connection 的預設 X Screen，再透過 `iscreen` 將編號傳回 `XOpenDisplay()`。 `XOpenDisplay()` 接著將其保存至 `dpy->default_screen`

本文使用的 [`xinit: xinit.c:94`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/xinit.c#L94) 將預設 display name 設為 `:0`，並在 [`xinit: xinit.c:657`](https://gitlab.freedesktop.org/xorg/app/xinit/-/blob/xinit-1.4.2/xinit.c#L657-L658) 傳給 session clients。 `:0` 沒有指定 X Screen 編號，因此 libX11 會將 X Screen 0 選為 `twm` 這條 connection 的預設 X Screen

後續轉換保留了 Xorg 編碼 Screen records 時使用的順序。 `setup.numRoots` 來自 `screenInfo.numScreens`，因此 `dpy->nscreens` 會得到相同的 X Screen 數量。 Xorg 寫入的第一筆 `xWindowRoot` 會成為 `dpy->screens[0]`，第二筆會成為 `dpy->screens[1]`，依此類推

其中 libX11 提供了能以這組欄位來找到預設 X Screen 與 Root Window 的 macros。 以下程式碼來自 [`libX11: include/X11/Xlib.h:91`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/include/X11/Xlib.h#L91-L107) 與 [`libX11: include/X11/Xlib.h:122`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/include/X11/Xlib.h#L122-L126)：

```c
// [libX11: include/X11/Xlib.h:91-107,122-126]
#define RootWindow(dpy, scr) (ScreenOfDisplay(dpy, scr)->root)
#define DefaultScreen(dpy) (((_XPrivDisplay)(dpy))->default_screen)
...
#define ScreenCount(dpy) (((_XPrivDisplay)(dpy))->nscreens)
...
#define ScreenOfDisplay(dpy, scr) (&((_XPrivDisplay)(dpy))->screens[scr])
```

`twm` 會以 `DefaultScreen(dpy)` 讀取 `dpy->default_screen`。 回傳值是這條 `Display` connection 預設使用的 X Screen 編號。 本文只建立一個 X Screen，因此該編號是 0，而 `RootWindow(dpy, 0)` 會從 `dpy->screens[0].root` 取得 Root Window XID

至此可以直接對照 X server 與 X11 client 兩側的 objects：

- Xorg 行程中的 `screenInfo.screens[i]` 指向 X Screen `i` 的 `ScreenRec`，保存 server-side 狀態與 callbacks
- 每個 libX11 `Display` 都有自己的 `screens[i]`，保存該 connection 從 setup reply 取得的 X Screen `i` 資料，供 application 查詢 Root Window XID、尺寸、depths、visuals 與預設 colormap

兩側以相同的陣列索引 `i` 表示同一個 X Screen，但不是同一個 C struct instance，也沒有跨行程的 pointer 關係。 這些 Screen records 保存的是 X Screen metadata，整張桌面的 pixels 則位於後面會看到的 screen Pixmap 與 front BO storage

X11 client 使用的 API 也有不同選擇：

- Xlib／libX11 提供歷史悠久、以 `Display` 與函式呼叫為中心的 API，許多既有程式與教學材料都採用這一層。 它替呼叫端處理較多 request buffering 與 reply／event bookkeeping，也會隱藏多數 sequence number、cookie 與等待 reply 的時機，因此呼叫端較不方便自行組織多筆非同步 request／reply
- XCB／libxcb 的 API 更貼近 protocol，會明確回傳 request cookie，呼叫端可自行決定何時等待 reply。 這讓非同步處理與批次送出更直接，代價是程式必須處理較多 protocol-level 細節
- GTK、Qt 等較高階 GUI toolkit 會再提供 widget、layout 與輸入處理。 Application 可以把大部分 Window 與 event 細節交給 toolkit，但追原始 X11 request 時還要穿過額外的抽象層

這些選擇可以共存。 [`libX11: configure.ac:81`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/configure.ac#L78-82) 顯示 libX11 1.8.7 本身就把 `xcb` 列為必要相依項。 本文的 `twm` 經 Xt 進入 Xlib，`glxgears` 稍後則會直接呼叫 Xlib。 兩者都由 libX11 建立 connection state

#### `twm` 在 Root Window 取得 window manager 角色

在本文的 X11 session 中，`twm` 會比使用者稍後啟動的 `glxgears` 更早完成上述 connection setup，並透過自己的 libX11 `Display` 取得 X Screen 與 Root Window 資料。 不過，一條普通的 X11 connection 還不足以管理其他 clients 的 Windows。 `twm` 還要在 Root Window 上選取特定 events，取得這個 X Screen 的 window manager 角色

接下來把 application 為了顯示自身內容而建立的 X11 Window 稱為 application Window。 `twm` 取得 window manager 角色後，便能管理 Root Window 下方的 application Windows

`twm` 是本文使用的視窗管理政策 controller。 它負責決定 placement、decoration、move、resize、restack 與 focus policy。 實際的 Window tree、geometry、stacking 與 clip state 則保存在 Xorg，由 Xorg 依 requests 修改

先看 `twm` 如何告訴 Xorg，它準備管理 Root Window 下方的 application Windows。 [`twm: src/twm.c:255`](https://gitlab.freedesktop.org/xorg/app/twm/-/blob/twm-1.0.12/src/twm.c#L255-460) 的 `main()` 透過 `XtOpenDisplay()` 取得 `Display *`，接著對每個 X Screen 的 Root Window 呼叫 `XSelectInput()`：

```c
// [twm: src/twm.c:255,381-383,442-451]
int
main(int argc, char *argv[])
{
    ...
    if (!(dpy = XtOpenDisplay(appContext, display_name, "twm", "twm",
                              NULL, 0, &zero, NULL))) {
        twmError("unable to open display \"%s\"", XDisplayName(display_name));
    }
    ...
    for (scrnum = firstscrn; scrnum <= lastscrn; scrnum++) {
        ...
        RedirectError = FALSE;
        XSetErrorHandler(CatchRedirectError);
        XSelectInput(dpy, RootWindow(dpy, scrnum),
                     ColormapChangeMask | EnterWindowMask |
                     PropertyChangeMask | SubstructureRedirectMask |
                     KeyPressMask | ButtonPressMask | ButtonReleaseMask);
        XSync(dpy, 0);
        XSetErrorHandler(TwmErrorHandler);

        if (RedirectError) {
            ...
            continue;
        }

        numManaged++;
        ...
    }
    ...
}
```

`XSelectInput()` 的第二個參數是 `RootWindow()` 從 `Screen[]` 取出的 Root Window XID，第三個參數則列出 `twm` 想接收的 events。 `SubstructureRedirectMask` 表示這條 connection 要接收 Root Window children 的重導向事件，讓 `twm` 能執行上述管理政策

[`libX11: src/SelInput.c:33`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/src/SelInput.c#L33-48) 會把這個 API 呼叫組成 `ChangeWindowAttributes` request。 [`Xorg: dix/events.c:4542`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/events.c#L4542-L4608) 的 `EventSelectForWindow()` 再檢查具排他性的 `SubstructureRedirectMask` 是否已由其他 client 選取，沒有衝突時才保存 `twm` 的 event mask

`twm` 隨即呼叫 `XSync()`，讓 request 抵達 server，也讓可能的 X error 回到暫時安裝的 error handler。 若另一個 window manager 已經選取同一個 mask，這筆 `XSelectInput()` request 會產生 `BadAccess`，`RedirectError` 也會被設為 `TRUE`。 `twm` 此時會放棄管理該 Screen。 確認沒有 `RedirectError` 後，`twm` 才取得 application Windows 的管理角色：

```callgraph
twm 呼叫 XSelectInput(dpy, RootWindow(...),
                       ... | SubstructureRedirectMask | ...)
  │
  │  // 前面的程式碼片段顯示 twm 的 call site
  ↓
[libX11: src/SelInput.c:33]
int XSelectInput(Display *dpy, Window w, long mask)
  │
  ├─ GetReqExtra(ChangeWindowAttributes, 4, req)
  ├─ req->window = w
  ├─ req->valueMask = CWEventMask
  └─ OneDataCard32(dpy, ..., mask)
       // 把 SubstructureRedirectMask 所在的 event mask 寫進 request payload
  ↓
[twm: src/twm.c:448] XSync(dpy, 0)
  │
  │  // flush queued requests，並等待 Xorg 處理完成
  ↓
[Xorg: dix/dispatch.c:777]
int ProcChangeWindowAttributes(ClientPtr client)
  │
  ├─ dixLookupWindow(&pWin, stuff->window, ...)
  └─ ChangeWindowAttributes(pWin, stuff->valueMask,
                            (XID *)&stuff[1], client)
  ↓
[Xorg: dix/window.c:1129]
int ChangeWindowAttributes(WindowPtr pWin, Mask vmask,
                           XID *vlist, ClientPtr client)
  │
  │  case CWEventMask:
  └─     EventSelectForWindow(pWin, client, (Mask)*pVlist)
  ↓
[Xorg: dix/events.c:4542]
XRetCode EventSelectForWindow(WindowPtr pWin, ClientPtr client, Mask mask)
  │
  ├─ 若其他 client 已選取 AtMostOneClient 中的同一個 mask：
  │    └─ return BadAccess
  └─ 否則保存這個 client 的 event mask
  ↓
X11 error 或同步結果回到等待中的 XSync()
  ↓
[twm: src/twm.c:451] if (RedirectError) { ... }
  │
  ├─ BadAccess 進入 CatchRedirectError()：RedirectError = TRUE
  └─ 沒有 error：twm 取得這個 Root Window 下方 application Windows 的管理角色
```

##### Window manager 的其他選擇

Window manager 也可以採用不同的視窗安排政策：

- `twm` 是輕量的 stacking window manager，讓視窗彼此重疊，並以相對直接的 Xt／Xlib 程式碼實作外框、移動、stacking 與 focus。 它的元件少、控制路徑短，但不提供完整桌面環境整合
- 其他 stacking window managers 可以在相同的 X11 角色上增加工作區、較複雜的 decoration 與管理政策，代價是多出相應的狀態與元件
- tiling window managers 會依規則自動安排畫面空間，減少手動擺放與重疊，適合鍵盤導向的操作方式，但 placement 與 decoration policy 會和本文的 `twm` 例子不同

Window manager 負責 placement、move／resize、restack 與 focus，compositor 則合成 redirected contents。 同一個行程可以同時實作兩種角色。 本文的 `twm` 只負責 window management

到這裡，`twm` 已取得 window manager 角色。 下一個尚未受管理的 application Window 要求 map 時，Xorg 會先送出 `MapRequest`，讓 `twm` 決定如何管理它

### `glxgears` 如何得到一個能夠 rendering 的視窗

X11 session 就緒後，使用者從 `xterm` 啟動 `glxgears`。 這個 client 會建立自己的 X11 connection，選出 Xorg 與 OpenGL 都能接受的 pixel format，建立 application Window，再建立一組保存 OpenGL state 的 rendering context。 `twm` 會為 Window 加上 frame，`glXMakeCurrent()` 最後把 context 與同一個 Window XID 接成 rendering target

#### `glxgears` 建立 application Window 與 OpenGL context

使用者在 `xterm` 輸入 `glxgears` 後，新的 application 行程要先連到 Xorg，再建立一個能同時供 X11 顯示與 OpenGL rendering 使用的 Window。 前一節已經看過 `twm` 如何取得 window manager 角色，現在沿著 `glxgears` 原始程式碼的實際順序，看看這個新視窗最初如何建立

`glxgears` 的 application Window 用來顯示齒輪內容。 建立它以前，application 要先選出一個 X11 visual，決定 X server 如何解讀 Window 的 pixel values。 Application 還要建立 OpenGL context，用來保存 OpenGL state、object bindings 與 driver-side rendering state。 後面的 `glXMakeCurrent()` 才會把 context 與 application Window 接成一組 rendering environment

`main()` 先呼叫 `XOpenDisplay()`。 這會替 `glxgears` 建立自己的 X11 connection，以及屬於這條 connection 的 libX11 `Display` 與 `Screen[]`

接著，`make_window()` 先找出要使用的 X Screen。 它會從該 Screen 取得 Root Window，並選擇 visual。 `XCreateWindow()` 會使用這些資料建立 application Window，`glXCreateContext()` 則會建立 OpenGL context。 回到 `main()` 後，下一行才要求顯示 Window：

```c
// [mesademos: src/xdemos/glxgears.c:701-757]
int
main(int argc, char *argv[])
{
   ...
   Display *dpy;
   Window win;
   GLXContext ctx;
   ...

   dpy = XOpenDisplay(dpyName);
   if (!dpy) {
      ...
      return -1;
   }
   ...
   make_window(dpy, "glxgears", x, y, winWidth, winHeight, &win, &ctx);
   XMapWindow(dpy, win);
   glXMakeCurrent(dpy, win, ctx);
   ...
}
```

以下是 `make_window()` 中決定 X Screen、visual、Window 與 context 的關鍵片段。 `DefaultScreen(dpy)` 從 `Display` 取得這條 connection 預設使用的 X Screen 編號，本文會得到 0。 `RootWindow(dpy, scrnum)` 再從 `dpy->screens[scrnum]` 取得該 X Screen 的 Root Window XID：

```c
// [mesademos: src/xdemos/glxgears.c:464-555]
static void
make_window(Display *dpy, const char *name,
            int x, int y, int width, int height,
            Window *winRet, GLXContext *ctxRet)
{
   int attribs[64];
   int i = 0;
   int scrnum;
   Window root;
   Window win;
   GLXContext ctx;
   XVisualInfo *visinfo;
   XSetWindowAttributes attr;
   unsigned long mask;
   ...

   attribs[i++] = GLX_RGBA;
   attribs[i++] = GLX_DOUBLEBUFFER;
   ...
   attribs[i++] = GLX_DEPTH_SIZE;
   attribs[i++] = 1;
   ...
   attribs[i++] = None;

   scrnum = DefaultScreen(dpy);
   root = RootWindow(dpy, scrnum);

   visinfo = glXChooseVisual(dpy, scrnum, attribs);
   if (!visinfo) {
      ...
      exit(1);
   }

   attr.background_pixel = 0;
   attr.border_pixel = 0;
   attr.colormap = XCreateColormap(dpy, root, visinfo->visual, AllocNone);
   attr.event_mask = StructureNotifyMask | ExposureMask | KeyPressMask;
   mask = CWBackPixel | CWBorderPixel | CWColormap | CWEventMask;

   win = XCreateWindow(dpy, root, x, y, width, height,
                       0, visinfo->depth, InputOutput,
                       visinfo->visual, mask, &attr);
   ...
   ctx = glXCreateContext(dpy, visinfo, NULL, True);
   if (!ctx) {
      ...
      exit(1);
   }
   ...
   *winRet = win;
   *ctxRet = ctx;
}
```

每筆 GLX framebuffer configuration 都會描述一種可供 OpenGL drawable 使用的 buffer 組態，其中包含可搭配的 X11 visual、color buffer 格式、depth／stencil buffer 大小與 double-buffering 能力。 `glXChooseVisual()` 會用 application 提供的 GLX attributes 篩選這些 configurations，例如要求 RGBA color、以 `GLX_DEPTH_SIZE` 指定 OpenGL depth buffer 至少具有多少 bits，以及要求 double buffering。 它最後會回傳相容 visual 對應的 `XVisualInfo`

X11 visual 描述 X server 應如何解讀 Window 的 pixel values，例如 color depth、color class 與 RGB channel masks。 以下程式碼節錄自 [`libX11: include/X11/Xutil.h:287`](https://gitlab.freedesktop.org/xorg/lib/libx11/-/blob/libX11-1.8.7/include/X11/Xutil.h#L287-302)：

```c
// [libX11: include/X11/Xutil.h:287-302]
typedef struct {
    Visual *visual;
    VisualID visualid;
    int screen;
    int depth;
    ...
    unsigned long red_mask;
    unsigned long green_mask;
    unsigned long blue_mask;
    ...
} XVisualInfo;
```

`visual` 指向選定的 libX11 `Visual` object，`visualid` 是 X server 識別該 visual 的 ID。 `screen` 記錄它所屬的 X Screen 編號，`depth` 則是使用這個 visual 建立 drawable 時使用的 color depth。 TrueColor 與 DirectColor visual 會以三個 channel masks 描述 red、green 與 blue 在 pixel value 中使用的 bits

`XCreateWindow()` 接著使用 Root Window XID 作為 `parent`，並帶入相同的 visual 與 depth。 對 `glxgears` 而言，回傳的 `win` 保存 application Window 的 XID。 GLX 後面會把這個 XID 當成 drawable，也就是 context 要讀寫的 X11 rendering target

libX11 會配置新的 XID，並把 `CreateWindow` request 排入這條 connection。 Xorg 收到 request 後，以 Root Window 的 `WindowRec` 作為 `pParent`，配置新的 `WindowRec`，保存 XID、visual、depth、geometry 與 parent，再把它接進 Root Window 的 child list：

```callgraph
[mesademos: src/xdemos/glxgears.c:525]
win = XCreateWindow(dpy, root, x, y, width, height,
                    0, visinfo->depth, InputOutput,
                    visinfo->visual, mask, &attr)
  │
  ↓
[libX11: src/Window.c:100]
Window XCreateWindow(Display *dpy, Window parent,
                     int x, int y, unsigned int width,
                     unsigned int height, unsigned int borderWidth,
                     int depth, unsigned int class, Visual *visual,
                     unsigned long valuemask,
                     XSetWindowAttributes *attributes)
  │
  ├─ GetReq(CreateWindow, req)
  ├─ req->parent = parent
  ├─ req->depth = depth
  ├─ req->visual = visual->visualid
  └─ wid = req->wid = XAllocID(dpy)
       ↓
[Xorg: dix/dispatch.c:765]
int ProcCreateWindow(ClientPtr client)
  │
  └─ DoCreateWindowReq(client, stuff, ...)
       ↓
[Xorg: dix/dispatch.c:735]
int DoCreateWindowReq(ClientPtr client,
                      xCreateWindowReq *stuff, XID *xids)
  │
  ├─ dixLookupWindow(&pParent, stuff->parent, ...)
  └─ dixCreateWindow(stuff->wid, pParent, ..., stuff->depth,
                     client, stuff->visual, &rc)
       ↓
[Xorg: dix/window.c:738]
WindowPtr dixCreateWindow(Window wid, WindowPtr pParent,
                          int x, int y, unsigned w, unsigned h,
                          unsigned bw, unsigned class, Mask vmask,
                          XID *vlist, int depth, ClientPtr client,
                          VisualID visual, int *error)
  │
  ├─ pScreen = pParent->drawable.pScreen
  ├─ 驗證 depth 與 visual 是否可供這個 X Screen 使用
  ├─ 配置 WindowRec，設定 drawable.id = wid
  ├─ pWin->parent = pParent
  └─ 將 pWin 接到 pParent 的 child／sibling links
```

Xorg 用 `DrawableRec` 保存可繪製 object 共有的 XID、座標、尺寸、depth 與所屬 X Screen。 `WindowRec` 以 `drawable` 內嵌這份資料，再用 `parent`、children 與 sibling links 保存 Window tree

下面三段定義分別來自 [`Xorg: include/pixmapstr.h:57`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/pixmapstr.h#L57-L69)、[`Xorg: include/xlibre_ptrtypes.h:22`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/xlibre_ptrtypes.h#L22-L23) 與 [`Xorg: include/windowstr.h:118`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/windowstr.h#L118-L149)：

```c
// [Xorg: include/pixmapstr.h:57-69]
typedef struct _Drawable {
    unsigned char type;
    unsigned char class;
    unsigned char depth;
    unsigned char bitsPerPixel;
    XID id;
    short x;
    short y;
    unsigned short width;
    unsigned short height;
    ScreenPtr pScreen;
    ...
} DrawableRec;

// [Xorg: include/xlibre_ptrtypes.h:22-23]
typedef struct _Window *WindowPtr;
typedef struct _Window WindowRec;

// [Xorg: include/windowstr.h:118-149]
struct _Window {
    DrawableRec drawable;
    PrivateRec *devPrivates;
    WindowPtr parent;
    WindowPtr nextSib;
    WindowPtr prevSib;
    WindowPtr firstChild;
    WindowPtr lastChild;
    ...
    unsigned mapped:1;
    unsigned realized:1;
    unsigned viewable:1;
    ...
};
```

這三個欄位記錄 Window 從收到 map request 到能參與畫面更新的狀態：

- `mapped` 表示 `MapWindow` request 已獲准，Xorg 已將 `WindowRec::mapped` 設為 `TRUE`
- `realized` 表示這個已 mapped Window 的 ancestors 也都已 mapped，Xorg 已呼叫 X Screen 的 `RealizeWindow` callback
- `viewable` 表示一個 `InputOutput` Window 已 realized，可以參與可見範圍計算

`drawable.pScreen` 指向這個 Window 所屬的 `ScreenRec`。 `parent` 指向父 Window，`firstChild` 與 `lastChild` 記錄直屬 children 的兩端，同一層的 children 再以 `nextSib` 與 `prevSib` 互相連接。 `firstChild` 位於最上層，`lastChild` 位於最下層，因此 sibling links 同時保存相同 parent 下的 stacking order

剛處理完 `CreateWindow` request 時，application Window 尚未 map，`twm` 也還沒建立外框。 這棵 tree 的相關部分如下：

```text
X Screen 0／ScreenRec（管理這棵 Window tree）
  │
  │  ScreenRec::root
  ↓
Root Window／WindowRec（Window tree 的根節點）
  │
  │  firstChild／nextSib／prevSib 串接同一層的 Windows
  ↓
glxgears application Window／WindowRec
  │
  │  parent 指回 Root Window
  │  mapped = FALSE
```

`glXCreateContext()` 最後使用同一份 `XVisualInfo` 建立相容的 OpenGL context。 此時 context 與 application Window 都已建立，但還沒有綁在一起。 `main()` 接下來會先呼叫 `XMapWindow()`，再以 `glXMakeCurrent()` 建立兩者的關係

#### `glxgears` 要求顯示 Window：`twm` 建立 frame 與 title

`XCreateWindow()` 只建立 X11 Window resource。 要讓使用者看見它，`glxgears` 接著呼叫 `XMapWindow(dpy, win)`，要求 Xorg 將 application Window 放進可顯示狀態。 前一節的 `twm` 已經在 Root Window 選取 `SubstructureRedirectMask`，所以 Xorg 會先把這項要求轉成 `MapRequest` event，交給 `twm` 決定外框、初始位置與 stacking

`twm` 會建立一個 frame Window，作為包住 application Window 的外層矩形。 Frame 裡的 title Window 負責顯示標題列，原本的 application Window 則繼續保存齒輪內容

`XMapWindow()` 是非同步的 Xlib API。 它將 `MapWindow` request 排入 `glxgears` 的 X11 connection 後便能返回，application 隨即可以執行下一行 `glXMakeCurrent()`。 以下先暫停 application 這條執行路徑，沿著 request 進入 Xorg 與 `twm`，看清楚 Window 最後如何取得外框並進入可見狀態。 這段展開的是 request 的處理結果，不是 `XMapWindow()` 在 `glxgears` 行程中同步呼叫的函式鏈

這個 application Window 的 `override_redirect` 是 `False`。 Xorg 在 [`Xorg: dix/window.c:2631`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/window.c#L2631-L2694) 看見 parent Root Window 已有 `twm` 選取 redirect mask 後，不會立刻設定 `mapped`，而是把 `MapRequest` event 傳到 `twm` 的 connection

[`twm: src/events.c:143`](https://gitlab.freedesktop.org/xorg/app/twm/-/blob/twm-1.0.12/src/events.c#L143-168) 的 `InitEvents()` 已將 `MapRequest` 對到 `HandleMapRequest()`。 `HandleMapRequest()` 再對第一次出現的 application Window 呼叫 `AddWindow()`。 `AddWindow()` 會建立 frame 與 title Windows，並以 `XReparentWindow()` 把原本位於 Root Window 下方的 application Window 移到 frame 裡：

```callgraph
[mesademos: src/xdemos/glxgears.c:756]
XMapWindow(dpy, win)
  │
  ↓
[libX11: src/MapWindow.c:33]
int XMapWindow(Display *dpy, Window w)
  │
  │  GetResReq(MapWindow, w, req)
  │  // 建立只帶有 Window XID 的 MapWindow request
  ↓
[Xorg: dix/dispatch.c:896]
int ProcMapWindow(ClientPtr client)
  │
  ├─ dixLookupWindow(&pWin, stuff->id, client, DixShowAccess)
  └─ MapWindow(pWin, client)
  ↓
[Xorg: dix/window.c:2631]
int MapWindow(WindowPtr pWin, ClientPtr client)
  │
  ├─ if (!pWin->overrideRedirect && RedirectSend(pParent))
  └─     if (MaybeDeliverMapRequest(...)) return Success
         // application Window 仍為 unmapped
  ↓
MapRequest event 經 twm 的 X11 connection 抵達 event queue
  │
  ↓
[twm: src/events.c:347] void HandleEvents(void)
  │
  ├─ XtAppNextEvent(appContext, &Event)
  └─ DispatchEvent()
  ↓
[twm: src/events.c:317] Bool DispatchEvent(void)
  │
  │  EventHandler[Event.type]()
  │  // MapRequest slot 指向 HandleMapRequest
  ↓
[twm: src/events.c:1286] void HandleMapRequest(void)
  │
  │  Tmp_win = AddWindow(Event.xany.window, FALSE, NULL)
  ↓
[twm: src/add_window.c:147]
TwmWindow *AddWindow(Window w, int iconm, IconMgr *iconp)
  │
  ├─ [twm: src/add_window.c:829]
  │    tmp_win->frame = XCreateWindow(..., Scr->Root, ...)
  │    // 建立 frame Window
  ├─ [twm: src/add_window.c:844]
  │    tmp_win->title_w = XCreateWindow(..., tmp_win->frame, ...)
  │    // 建立 title Window
  ├─ [twm: src/add_window.c:890] XMapWindow(dpy, tmp_win->title_w)
  │    // frame 尚未 realized，title 先只記錄為 mapped
  └─ [twm: src/add_window.c:908]
       XReparentWindow(dpy, tmp_win->w,
                       tmp_win->frame, 0, tmp_win->title_height)
       ↓
     [libX11: src/RepWindow.c:32]
     int XReparentWindow(Display *dpy, Window w, Window p,
                         int x, int y)
       │
       ├─ req->window = w
       └─ req->parent = p
       ↓
     [Xorg: dix/dispatch.c:869]
     int ProcReparentWindow(ClientPtr client)
       │
       └─ ReparentWindow(pWin, pParent, stuff->x, stuff->y, client)
       ↓
     [Xorg: dix/window.c:2477]
     int ReparentWindow(WindowPtr pWin, WindowPtr pParent,
                        int x, int y, ClientPtr client)
       │
       ├─ 從原 parent 的 sibling chain 移除 pWin
       ├─ pWin->parent = pParent
       ├─ 插入新 parent 的 child／sibling links
       └─ 依新 parent 重新計算 absolute x／y
  ↓
[twm: src/events.c:1345] `glxgears` 沒有 WM_HINTS StateHint
  │
  └─ DeIconify(Tmp_win)
  ↓
[twm: src/menus.c:2377]
void DeIconify(TwmWindow *tmp_win)
  │
  ├─ XMapWindow(dpy, tmp_win->w)
  │    // 要求 map application Window
  └─ frame Window：
       ├─ Scr->NoRaiseDeicon：XMapWindow(dpy, tmp_win->frame)
       └─ 否則：XMapRaised(dpy, tmp_win->frame)
                    // 先排入 Above 的 ConfigureWindow，再排入 MapWindow
  ↓
第一筆 MapWindow request：application Window
  │
  ↓
[Xorg: dix/window.c:2631] int MapWindow(WindowPtr pWin, ClientPtr client)
  │
  ├─ application_window->mapped = TRUE
  └─ if (!pParent->realized) return Success
       // parent frame 尚未 realized
  ↓
第二筆 MapWindow request：frame Window
  │
  ↓
[Xorg: dix/window.c:2631] int MapWindow(WindowPtr pWin, ClientPtr client)
  │
  ├─ frame_window->mapped = TRUE
  ├─ RealizeTree(frame_window)
  │    └─ realize 已 mapped 的 frame、title 與 application Windows
  ├─ pScreen->ValidateTree(...)
  └─ pScreen->HandleExposures(...)
  ↓
frame、title 與 application Window 進入 viewable state
```

`twm` 加入的 frame、title 與 application Window 都是 Xorg 管理的 X11 Window objects。 Frame Window 是 Root Window 的 child，包住外框、標題列與 application 內容。 Title Window 負責顯示標題列，application Window 則保留給 `glxgears` 顯示齒輪：

```text
twm 管理以前
Root Window
  └─ glxgears application Window

twm 建立 frame 並 reparent 以後
Root Window
  └─ twm frame Window
       ├─ title Window
       └─ glxgears application Window
```

`XReparentWindow()` 只改變 application Window 在 Window tree 裡的 parent 與座標，不會改變它的 XID。 因此，`glxgears` 的 `win` 仍指向原本的 application Window。 後續 `glXMakeCurrent(dpy, win, ctx)` 與 `glXSwapBuffers(dpy, win)` 會繼續使用相同的 drawable identity

Application Window 的 map request 先設定 `mapped`，但 frame 尚未 realized，因此暫時返回。 等 frame 也被 map 後，`RealizeTree()` 才會連同已 mapped 的 title 與 application Windows 一起 realize。 Xorg 接著依三者的 geometry 與 stacking 計算可見範圍，使用者才會在桌面看見帶有青色外框與標題列的 `glxgears`

#### GLX 將 application Window 設為 current rendering target

剛才我們在 `glxgears` 的 `XMapWindow()` 暫停，沿著 X11 request 查看 Xorg 與 `twm` 最後如何管理這個 Window。 現在回到 `main()` 的下一行 `glXMakeCurrent(dpy, win, ctx)`。 由於 `XMapWindow()` 不會等待另一條 `twm` connection 完成整段管理流程，application 執行這一行時，Window 可能仍在等待 `twm` 處理 `MapRequest`。 Window 是否已經 viewable，不會改變 `win` 所代表的 XID

前面的 `glXChooseVisual()` 第一次讓 `glxgears` 進入 Mesa GLX。 Mesa 會為這個 libX11 `Display *` 建立 `glx_display`，並讓 `glx_display::screens[i]` 指向 X Screen `i` 對應的 `glx_screen`。 `glx_screen` 保存這個 X Screen 可用的 GLX visual／framebuffer configurations，以及 context 與 drawable operations 需要的 callbacks

因此，同一個 X Screen 在 Xorg、libX11 與 Mesa GLX 內分別有自己的 client-side 或 server-side object：

```callgraph
Xorg 行程
=================================================
[Xorg: dix/globals.c:65] screenInfo.screens[i]
  │
  │  指向 X Screen i 的 server-side ScreenRec
  │  connection setup reply 將必要資料編碼成 protocol records
  ↓
glxgears 行程：libX11
=================================================
[libX11: include/X11/Xlibint.h:72] Display::screens[i]
  │
  │  保存 setup reply 建立的 client-side Screen
  │  win 是這個 Screen 之下 application Window 的 XID
  ↓
glxgears 行程：Mesa GLX
=================================================
[Mesa: src/glx/glxclient.h:615] glx_display::screens[i]
  │
  │  指向 X Screen i 的 client-side glx_screen
  │  保存 GLX configurations 與 backend callbacks
  ↓
[Mesa: src/glx/glxclient.h:248] struct glx_context
  │
  │  ctx 指向 glXCreateContext() 建立的 context
  │  context 的 psc 指回這個 glx_screen
```

`glXMakeCurrent()` 的三個參數正好把這幾類 object 接在一起：`dpy` 指出 X11 connection，`win` 是同時作為 draw 與 read drawable 的 application Window XID，`ctx` 則是要設為 current 的 OpenGL context。 GLX 可以把尚未 map 的相容 X11 Window 設為 drawable，判斷依據是 Window XID、visual 與 context configuration，不要求 Window 已進入 viewable state。 Mesa 的 `MakeContextCurrent()` 會先透過 context backend 的 `bind()` 連接 drawable，成功後再記錄 current display、draw drawable 與 read drawable：

```c
// [Mesa: src/glx/glxcurrent.c:100-188]
static Bool
MakeContextCurrent(Display *dpy, GLXDrawable draw, GLXDrawable read,
                   GLXContext gc_user, unsigned opcode)
{
   struct glx_context *gc = (struct glx_context *) gc_user;
   struct glx_context *oldGC = __glXGetCurrentContext();
   ...

   if (oldGC != &dummyContext) {
      oldGC->vtable->unbind(oldGC);
      oldGC->currentDpy = NULL;
      ...
   }
   __glXSetCurrentContextNull();

   if (gc) {
      ...
      if (gc->vtable->bind(gc, draw, read) != Success) {
         ret = GL_FALSE;
      } else {
         gc->currentDpy = dpy;
         gc->currentDrawable = draw;
         gc->currentReadable = read;
         __glXSetCurrentContext(gc);
      }
   }
   ...
   return ret;
}

Bool
glXMakeCurrent(Display *dpy, GLXDrawable draw, GLXContext gc)
{
   return MakeContextCurrent(dpy, draw, draw, gc, X_GLXMakeCurrent);
}
```

`bind()` 讓 backend 為這個 context 接上 `win` 對應的 rendering buffers。 `currentDpy`、`currentDrawable` 與 `currentReadable` 記錄 context 當下綁定的 X11 connection 與 drawable。 `__glXSetCurrentContext()` 則讓呼叫 `glXMakeCurrent()` 的執行緒取得 current context。 完整的 thread-local dispatch 與 loader callback 路徑會在後文的 GLX 章節展開

當 `glXMakeCurrent()` 成功後，OpenGL default framebuffer 便會對應到 application Window 的 rendering buffers。 後續 `glClear()` 與其他 OpenGL operations 會使用這個 current context 與 rendering target。 等 application 完成一幀，`glXSwapBuffers(dpy, win)` 才會再次進入 GLX，要求交付這個 drawable 的 back buffer

#### 從 `glClear()` 看 OpenGL 呼叫需要哪些 object 與角色

`glXMakeCurrent()` 完成後，application 才進入反覆產生 frames 的 rendering loop。 下面以其中一輪為例：`glClear()` 先清除 color buffer 與 depth buffer，application 接著畫出新的齒輪角度，最後呼叫 `glXSwapBuffers()` 交付這一幀

```c
while (window_is_open) {
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    draw_gears_with_opengl(...);
    glXSwapBuffers(display, window);
}
```

要理解 `glClear()` 如何執行，以及相同的 OpenGL calls 為什麼能落到不同 renderer，我們需要先認識下列 object 與角色：

- OpenGL context
  - 代表一組 rendering environment，保存 current OpenGL state 與 object bindings。 `glClear()` 的參數只表示了要清除哪些 buffers，實際使用的 clear color 來自先前由 `glClearColor()` 設定的 context state
- rendering target
  - 表示這次 operation 要寫入的 color、depth 或 stencil buffers。 對 `glClear()` 而言，實際目標來自目前綁定的 framebuffer
- OpenGL vendor 實作
  - 實際執行 OpenGL API 的 userspace 程式碼。 同一組 OpenGL 入口可以由不同 vendor 實作
- State Tracker 與 Gallium（Mesa 路徑）
  - Mesa OpenGL frontend 驗證 API 呼叫後，State Tracker 會將 OpenGL state 與 operations 轉成 Gallium 使用的形式。 Gallium 則提供 State Tracker 與不同 rendering drivers 共同遵守的介面與 framework，例如由 `pipe_context` 定義的 rendering callbacks
- Gallium driver（Mesa 路徑）
  - 實作 Gallium 定義的介面，接住 State Tracker 轉換後的 rendering work，再決定要由 CPU 直接算出 pixels、建立實體 GPU commands，或編碼成虛擬 GPU protocol

本文接下來固定追蹤 Mesa 提供的 OpenGL vendor 路徑。 OpenGL 呼叫會依序經過 Mesa OpenGL frontend、State Tracker 與 Gallium 介面，最後由 current context 使用的 Gallium driver 接手 rendering work

AMD 的 radeonsi、Intel 的 iris、軟體 drivers softpipe 與 llvmpipe，以及 VirGL guest driver 都是 Mesa 裡的 Gallium drivers。 它們接收的都是相同類型的 Gallium state 與 operations，但會用不同方法完成 rendering：

- softpipe 與 llvmpipe 會在 application 行程中使用 CPU 執行 vertex processing、rasterization 與 fragment processing，再把結果寫進 system memory 中的 color buffer。 softpipe 使用較直接的 C 實作，llvmpipe 則會透過 LLVM JIT 產生 CPU native code，並使用多個 worker threads 平行處理 tiles
- iris、radeonsi 等原生硬體 driver 會在 userspace 編譯 shader、配置 GPU resources 並建立 GPU commands，接著透過 kernel driver 將工作交給實體 GPU 執行
- VirGL guest driver 會把 Gallium rendering state 與 commands 編碼成 VirGL protocol，經 virtio-gpu 傳給 host，再由 host 上的 virglrenderer 交給 host 圖形堆疊執行

而如果 OpenGL vendor 是 NVIDIA proprietary OpenGL 堆疊，API 呼叫則會由 NVIDIA 的 userspace 函式庫接住，再配合 NVIDIA kernel module。 這條路徑就不會經過 Mesa OpenGL frontend、State Tracker 或 Gallium。 因此，系統有沒有安裝 Mesa，與該 OpenGL context 是否由 Mesa 實作，是兩個不同的問題

本文固定的 vGPU 2D 組態使用 Mesa `drisw` 與 softpipe。 `glClear()` 與後續的齒輪 draw calls 會由 softpipe 在 `glxgears` 行程中執行

一輪 rendering 完成時，Mesa client-side color buffer 已經保存新角度的齒輪 pixels。 Xorg 用來顯示整個桌面的 screen Pixmap，此時仍是上一份內容

齒輪持續轉動時，使用者把 `xterm` 拖到 `glxgears` 前方。 Mesa 已經算好的 frame 仍留在 color buffer，Xorg 則必須根據新的視窗位置，重新決定齒輪視窗有哪些區域可以顯示

### 使用者移動視窗時，可見範圍如何改變

application Window 與 rendering target 建立後，桌面操作仍會改變它能顯示的區域。 我們先追蹤 `twm` 如何把拖曳與升起視窗的決定送給 Xorg，再看 Xorg 如何更新 geometry、stacking 與一組可見矩形。 被遮住的內容重新露出時，`Expose` event 會要求 application 再次產生該區域

#### 使用者移動 `xterm`：`twm` 更新 geometry 與 stacking

現在使用者拖曳 `xterm` 的標題列，讓它遮住 `glxgears` 的右半部。 這個動作會改變 xterm frame 的位置，`twm` 也可能依政策將它升起。 Geometry 或 stacking 的變化都會改變 `glxgears` 仍然可見的範圍

`twm` 會從 pointer events 算出 xterm frame 的新座標，並依政策決定是否升起視窗。 Xorg 隨後更新 geometry 與 stacking，再重新計算各個 Windows 的可見範圍

在 [`twm: src/events.c:1492`](https://gitlab.freedesktop.org/xorg/app/twm/-/blob/twm-1.0.12/src/events.c#L1492-1580) 的 `HandleButtonRelease()` 中，拖曳結束會先呼叫 `SetupWindow()` 更新 geometry，再依 policy 決定是否呼叫 `XRaiseWindow()`。 [`twm: src/resize.c:752`](https://gitlab.freedesktop.org/xorg/app/twm/-/blob/twm-1.0.12/src/resize.c#L752-902) 的 `SetupWindow()` 會進入 `SetupFrame()`，為 application、title 與 frame Windows 更新 geometry，必要時也會調整 title highlight Window，並通知 application 它在 X Screen 上的新位置

接下來的 Xorg callgraph 會先使用 Region 與 `borderClip`。 Region 是由一個或多個矩形組成的座標範圍。 `WindowRec::borderClip` 則是 Window 保存的一個 Region，用來描述包含 border 在內的可顯示範圍

```callgraph
twm：更新 xterm frame geometry
=================================================
[twm: src/events.c:1492] void HandleButtonRelease(void)
  │
  ├─ xl = Event.xbutton.x_root - DragX - frame_border_width
  ├─ yt = Event.xbutton.y_root - DragY - frame_border_width
  └─ SetupWindow(Tmp_win, xl, yt,
                 Tmp_win->frame_width, Tmp_win->frame_height, -1)
  ↓
[twm: src/resize.c:752]
void SetupWindow(TwmWindow *tmp_win, int x, int y,
                 int w, int h, int bw)
  │
  └─ SetupFrame(tmp_win, x, y, w, h, bw, False)
       ↓
[twm: src/resize.c:761]
void SetupFrame(TwmWindow *tmp_win, int x, int y,
                int w, int h, int bw, Bool sendEvent)
  │
  ├─ 若 frame 只移動而沒有 resize：sendEvent = TRUE
  │    // application Window 的 frame-local geometry 不變，
  │    // 但它在 X Screen 上的座標已經改變
  │
  ├─ title Window：
  │    ↓
  │  [libX11: src/ReconfWin.c:35]
  │  int XConfigureWindow(Display *dpy, Window w, unsigned int mask,
  │                       XWindowChanges *changes)
  │    └─ GetReq(ConfigureWindow, req)
  │
  ├─ application Window：
  │    ↓
  │  [libX11: src/ConfWind.c:32]
  │  int XMoveResizeWindow(Display *dpy, Window w, int x, int y,
  │                        unsigned int width, unsigned int height)
  │    ├─ GetReqExtra(ConfigureWindow, 16, req)
  │    └─ req->mask = CWX | CWY | CWWidth | CWHeight
  │
  ├─ frame Window：
  │    ├─ frame_wc.x = x，frame_wc.y = y
  │    ├─ frame_wc.width = w，frame_wc.height = h
  │    └─ [twm: src/resize.c:860]
  │         XConfigureWindow(dpy, tmp_win->frame,
  │                          CWX | CWY | CWWidth | CWHeight, &frame_wc)
  │
  ├─ 若 title highlight Window 存在：
  │    └─ [twm: src/resize.c:878]
  │         XConfigureWindow(dpy, tmp_win->hilite_w,
  │                          CWX | CWWidth, &xwc)
  │
  └─ 若 sendEvent == TRUE：
       ├─ 建立 type = ConfigureNotify 的 XEvent
       └─ [libX11: src/SendEvent.c:37]
          Status XSendEvent(Display *dpy, Window w, Bool propagate,
                            long event_mask, XEvent *event)
            ├─ GetReq(SendEvent, req)
            └─ 將 synthetic ConfigureNotify 送給 application Window

Xorg：只追蹤 frame Window 的 ConfigureWindow request
=================================================
frame Window 的 ConfigureWindow request
  ↓
[Xorg: dix/dispatch.c:978]
int ProcConfigureWindow(ClientPtr client)
  │
  ├─ dixLookupWindow(&pWin, stuff->window, ...)
  └─ ConfigureWindow(pWin, stuff->mask, &stuff[1], client)
  ↓
[Xorg: dix/window.c:2160]
int ConfigureWindow(WindowPtr pWin, Mask mask,
                    XID *vlist, ClientPtr client)
  │
  │  // frame request 包含新 x／y 與原有 width／height
  ├─ mask 同時包含 width／height：先設成 RESIZE_WIN
  ├─ requested width／height 與目前大小相同：size_change = FALSE
  ├─ size 沒變而 mask 包含 x／y：action = MOVE_WIN
  │
  └─ pScreen->MoveWindow(pWin, x, y, pSib, VTMove)
       ↓
     [Xorg: mi/miwindow.c:247]
     void miMoveWindow(WindowPtr pWin, int x, int y,
                       WindowPtr pNextSib, VTKind kind)
       ├─ 若 frame 可見：
       │    ├─ oldRegion = copy(pWin->borderClip)
       │    └─ MarkOverlappedWindows(...)
       ├─ 更新 frame 的 origin 與 drawable x／y
       ├─ SetWinSize(pWin)／SetBorderSize(pWin)
       ├─ MoveWindowInStack(pWin, pNextSib)
       ├─ ResizeChildrenWinSize(...)
       │    // 依 frame 的位移更新 title 與 application child Windows
       └─ 若可見區域受到影響：
            ├─ pScreen->ValidateTree(...)
            ├─ pScreen->CopyWindow(pWin, oldpt, oldRegion)
            └─ pScreen->HandleExposures(...)
  ↓
Xorg 依新的 geometry 重新計算可見區域

twm：依 policy 選擇是否升起 xterm
=================================================
[twm: src/events.c:1492] void HandleButtonRelease(void)
  │
  │  if (!Scr->NoRaiseMove && !Scr->OpaqueMove)
  └─     XRaiseWindow(dpy, DragWindow)
  ↓
[libX11: src/RaiseWin.c:32]
int XRaiseWindow(Display *dpy, Window w)
  │
  ├─ GetReqExtra(ConfigureWindow, 4, req)
  └─ req->mask = CWStackMode，value = Above
  ↓
[Xorg: dix/dispatch.c:978]
int ProcConfigureWindow(ClientPtr client)
  ↓
[Xorg: dix/window.c:2160]
int ConfigureWindow(WindowPtr pWin, Mask mask,
                    XID *vlist, ClientPtr client)
  │
  ├─ 只有 CWStackMode，位置與大小沒有改變
  ├─ 依 Above 計算目標 sibling pSib
  ├─ if (pWin->nextSib == pSib) return Success
  │    // Window 已在目標 stacking 位置
  └─ stacking 實際有變化：進入 ReflectStackChange()
       ↓
[Xorg: dix/window.c:2122]
static void ReflectStackChange(WindowPtr pWin, WindowPtr pSib,
                               VTKind kind)
  ├─ pFirstChange = MoveWindowInStack(pWin, pSib)
  └─ if (WasViewable && MarkOverlappedWindows(...))
       ├─ pScreen->ValidateTree(...)
       └─ pScreen->HandleExposures(...)
  ↓
stacking 實際改變時，Xorg 重新計算可見區域
```

本文畫面中的視窗具有 title，因此 `SetupFrame()` 會送出 title、application 與 frame 三筆核心 geometry requests。 若該 title 還有 highlight Window，便會再送出一筆 `ConfigureWindow`

在這次只改變 `xterm` frame 位置的拖曳中，title 與 application Windows 保持原有的 frame-local geometry，Xorg 可以在確認沒有實際改變後直接返回。 不過純移動已讓 application Window 在 X Screen 上的座標改變，所以 `SetupFrame()` 還會透過 `XSendEvent()` 傳送 synthetic `ConfigureNotify` 給 application

Frame request 帶有新 x／y 與既有 width／height。 `ConfigureWindow()` 因而先把 action 判成 `RESIZE_WIN`，確認 requested size 沒變且 x／y 有變後，才改走 `MOVE_WIN`

`miMoveWindow()` 先保存舊 `borderClip`，再更新 frame 本身的 origin 與 drawable 座標，重新計算它的 size／border Region。 接著呼叫 `MoveWindowInStack()`，讓 request 指定的 sibling position 生效。 `ResizeChildrenWinSize()` 之後才依 frame 的位移更新 title 與 application child Windows 的座標

`CopyWindow()` 搬移仍可重用的 pixels，`HandleExposures()` 則處理新露出、無法從舊位置還原的區域。 若 `twm` 接著要求升起視窗，`XRaiseWindow()` 會另外送出只包含 `CWStackMode` 的 request。 Window 還沒有位於目標 stacking 位置時，`ReflectStackChange()` 才會移動它，並為受影響的 viewable Windows 重新計算可見區域

剛才的 request 由使用者拖曳觸發，並由 `twm` 主動送給 Xorg。 Application 本身也能要求改變自己的位置、大小或 stacking，但這是另一個入口

Application 送出的 configure request 會先抵達 Xorg，再依相同的 redirect 機制轉成 `ConfigureRequest` event 交給 `twm`。 以下片段來自 [`Xorg: dix/window.c:2160`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/window.c#L2160-L2285)，用來追蹤 `ConfigureWindow()` 如何把 application 要求的位置、大小與 stacking 資訊放進 event：

```c
// [Xorg: dix/window.c:2160-2285]
int
ConfigureWindow(WindowPtr pWin, Mask mask, XID *vlist,
                ClientPtr client)
{
    WindowPtr pParent = pWin->parent;
    ...

    if ((!pWin->overrideRedirect) && (RedirectSend(pParent))) {
        xEvent event = {
            .u.configureRequest.window = pWin->drawable.id,
            .u.configureRequest.sibling =
                (mask & CWSibling) ? sibwid : None,
            .u.configureRequest.x = x,
            .u.configureRequest.y = y,
            .u.configureRequest.width = w,
            .u.configureRequest.height = h,
            .u.configureRequest.borderWidth = bw,
            .u.configureRequest.valueMask = mask,
            .u.configureRequest.parent = pParent->drawable.id
        };
        event.u.u.type = ConfigureRequest;
        event.u.u.detail = (mask & CWStackMode) ? smode : Above;
        ...
        if (MaybeDeliverEventToClient(pParent, &event,
                                      SubstructureRedirectMask, client))
            return Success;
    }

    ...
    // 沒有轉交給 window manager 時，才繼續套用 geometry 與 stacking
}
```

這次 event 會帶上 requested x／y、width／height、border width、sibling 與 stack mode。 `valueMask` 表示這次 request 實際指定了哪些欄位。 當其中包含 `CWStackMode` 時，`detail` 會保存 application 要求的 stack mode。 `MaybeDeliverEventToClient()` 回傳 `TRUE` 後，`ConfigureWindow()` 同樣會在實際改動 Window 以前回傳

`twm` 可以依自己的 placement／stacking policy 調整這些值，再透過自己的 X11 connection 送出 configure request

[`Xorg: dix/events.c:2553-2584`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/dix/events.c#L2553-L2584) 中的 `MaybeDeliverEventToClient(..., ClientPtr dontClient)` 在 Window 的 event mask 路徑以 `dixClientForWindow(pWin) == dontClient` 回傳 `FALSE`。 其他 client 的路徑則以 `SameClient(other, dontClient)` 回傳 `FALSE`。 因此，它會排除目前這一筆 request 的傳送 client

application 傳送的 request 可以轉給 `twm`，而 `twm` 送出的後續 request 不會再次進入 `twm` 的 event queue，Xorg 會繼續套用調整後的 geometry 與 stacking

最後，[`twm: src/events.c:143`](https://gitlab.freedesktop.org/xorg/app/twm/-/blob/twm-1.0.12/src/events.c#L143-L168) 的 `InitEvents()` 會把 `ConfigureRequest` event type 對到 `HandleConfigureRequest()`：

```c
// [twm: src/events.c:143-168]
void
InitEvents(void)
{
    ...
    EventHandler[MapRequest] = HandleMapRequest;
    ...
    EventHandler[ConfigureRequest] = HandleConfigureRequest;
    ...
}
```

`twm` 的 event loop 收到 `ConfigureRequest` 後，會透過這張表呼叫 [`twm: src/events.c:2227-2356`](https://gitlab.freedesktop.org/xorg/app/twm/-/blob/twm-1.0.12/src/events.c#L2227-L2356) 的 `HandleConfigureRequest()`

Handler 會讀取前述 `valueMask` 與各個 requested values。 尚未由 `twm` 管理的 Window，或 icon Window，會直接以 requested geometry 呼叫 `XConfigureWindow()`

已管理 Window 的 request 若包含 `CWStackMode` 且啟用 `Tmp_win->stackmode`，會將 sibling 對應到 frame，並對 frame 呼叫 `XConfigureWindow()`。 已管理 Window 的 geometry 則會調整 frame 的 x／y、width／height 與 border width，最後呼叫 `SetupWindow()`

無論 geometry change 是由使用者拖曳還是 application request 引起，Xorg 最後都要回答同一個問題：`xterm` 移到齒輪前方後，`glxgears` application Window 還有哪些矩形可以顯示。 Xorg 會用 Window tree 與 Region 保存計算這個答案所需的狀態：

- Window 保存 parent／child、geometry、stacking 與 screen origin
- `WindowRec::borderClip` 是包含 Window border 在內，目前仍可顯示的 Region
- `WindowRec::clipList` 是 Window 內部目前仍可顯示的 Region

Region 在 Xorg 中是一組矩形，不是保存 pixels 的 image。 以下程式碼來自 [`Xorg: include/regionstr.h:50`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/regionstr.h#L50-L100)，用來顯示 `RegionRec` 的底層型態，以及 Xorg 如何取得其中的矩形數量與矩形陣列：

```c
// [Xorg: include/regionstr.h:50-100]
typedef struct pixman_region16 RegionRec, *RegionPtr;

static inline int
RegionNumRects(RegionPtr reg)
{
    return (int)(reg->data ? reg->data->numRects : 1);
}

static inline BoxPtr
RegionRects(RegionPtr reg)
{
    return reg->data ? (BoxPtr)(reg->data + 1) : &reg->extents;
}
```

一個簡單的 Region 可以只由 `extents` 表示。 需要描述不規則可見範圍時，`data` 後方則會接著保存多個 `BoxRec`。 因此，當 `xterm` 蓋住齒輪視窗右半部時，`glxgears` 的 `clipList` 會保存仍可見的矩形座標，而不是另一張只有黑白值的 pixel mask

GC（Graphics Context）是 Xorg 用來保存 drawing operation state 的 object，其中包含顏色、raster operation、subwindow mode 與 client clip。 程式碼中的 `GCPtr` 是指向這個 object 的 pointer。 `miComputeCompositeClip()` 會依 GC state 將 Window 的可見範圍與 client clip 組成這次 operation 使用的 composite clip

下面三段程式碼把 application Window 的 `clipList` 接到稍後的 `PutImage` operation：

- [`Xorg: include/windowstr.h:126`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/windowstr.h#L126-L127) 保存 `clipList` 與 `borderClip` 兩種 Region
- [`Xorg: mi/migc.c:99`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/mi/migc.c#L99-L154) 在一般 `ClipByChildren` 模式下以 `clipList` 建立 GC composite clip
- [`Xorg: fb/fbimage.c:27`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/fb/fbimage.c#L27-L70) 把 drawable origin 加到 request 座標，並將 composite clip 傳給 framebuffer 寫入函式

```c
// [Xorg: include/windowstr.h:126-127]
struct _Window {
    ...
    RegionRec clipList;         /* clipping rectangle for output */
    RegionRec borderClip;       /* NotClippedByChildren + border */
    ...
};

// [Xorg: mi/migc.c:99-154]
void
miComputeCompositeClip(GCPtr pGC, DrawablePtr pDrawable)
{
    if (pDrawable->type == DRAWABLE_WINDOW) {
        WindowPtr pWin = (WindowPtr) pDrawable;
        RegionPtr pregWin;
        ...

        if (pGC->subWindowMode == IncludeInferiors) {
            pregWin = NotClippedByChildren(pWin);
            ...
        } else {
            pregWin = &pWin->clipList;
            ...
        }

        if (!pGC->clientClip) {
            pGC->pCompositeClip = pregWin;
            ...
        } else {
            ...
            RegionIntersect(..., pregWin, pGC->clientClip);
            ...
        }
    }
    ...
}

// [Xorg: fb/fbimage.c:27-70]
void
fbPutImage(DrawablePtr pDrawable, GCPtr pGC, int depth,
           int x, int y, int w, int h, int leftPad,
           int format, char *pImage)
{
    ...
    x += pDrawable->x;
    y += pDrawable->y;
    ...
    case ZPixmap:
        ...
        fbPutZImage(pDrawable, fbGetCompositeClip(pGC),
                    pGC->alu, pPriv->pm,
                    x, y, w, h, src, srcStride);
    }
}
```

`borderClip` 包含 Window border 與不受 child clipping 影響的範圍，供 Window validation 等流程使用。 本例的 `PutImage` 使用一般 GC subwindow mode，因此真正限制 pixel write 的是由 application Window `clipList` 與 GC client clip 合成的 `pCompositeClip`

`xterm` 移到 `glxgears` 前方後，Xorg 依 Window tree、geometry 與 stacking 重算可見範圍。 `clipList` 由一個或多個矩形組成，不是 pixel map。 Xorg 會從 `glxgears` application Window 的可見區域扣掉 xterm frame 覆蓋的範圍，再與 GC／client clip 合成 drawing operation 使用的 composite clip

在未 redirect 的路徑中，application 後續送出的 drawing request 會以 application Window 為 drawable。 Xorg 先把 Window-local 座標加上這個 Window 的 screen origin，再將 `clipList` 與 GC／client clip 合成 composite clip，最後只把仍然可見的矩形寫進 screen Pixmap。 被 `xterm` 蓋住的範圍不在這組 rectangles 內，因此不會改寫畫面上既有的 xterm pixels

#### 使用者移開 `xterm`：`Expose` 與 compositor

當 `xterm` 移開時，Xorg 會算出 `glxgears` 剛重新露出的 Region。 前面的 [`mesademos: src/xdemos/glxgears.c:525`](https://github.com/JoakimSoderberg/mesademos/blob/master/src/xdemos/glxgears.c#L525) 片段已在建立 application Window 時把 `ExposureMask` 放進 `attr.event_mask`

`miWindowExposures()` 因此會將 `Expose` event 傳給 `glxgears`。 Application 收到 event 後會再次產生內容。 持續執行的 rendering loop 也會讓後續 frames 填入重新露出的範圍

本文的 application Window 維持 `RedirectDrawNone`，並由 `Screen::GetWindowPixmap()` 沿著 parent 的 Pixmap mapping 取得 screen Pixmap。 Root Window、frame、title 與 application Windows 都使用這份 Pixmap。 每個 Window 描述共同 storage 中不同的位置與可見範圍。 Application Window 的 `backingStore` 設為 `NotUseful`，因此沒有另一份 storage 保留被遮住的 pixels

`xterm` 遮住齒輪時，screen Pixmap 的那塊區域已經改為保存 `xterm` 的 pixels。 `glxgears` 又沒有自己的 off-screen backing Pixmap，因此 Xorg 無法直接從另一份既有 storage 還原齒輪內容，application 必須在收到 `Expose` 後重新產生該區域

若 Composite client 對 Window 或 subwindows 送出 redirect request，Window drawing 會改為進入各自的 off-screen backing Pixmap。 compositor 可以保留被遮住的內容，穩定地重新合成畫面，也能加入陰影、透明與動畫。 代價是多出 backing storage、同步與每幀合成工作

使用者移開 `xterm` 後，`glxgears` 收到 `Expose` 並產生下一個完整 frame。 接下來就從這一幀完成 rendering 的 color buffer 繼續往下看，追蹤它如何交給 Xorg，最後進入 scanout

### 完成的一幀如何從 Mesa 走到 scanout

新的齒輪 frame 完成 rendering 後，pixels 先停在 Mesa client-side color buffer。 `glXSwapBuffers()` 會讓 `drisw` 將這份內容交給 Xorg，Xorg 再套用 Window origin 與 composite clip，更新 screen Pixmap／front BO。 最後，dirty update 會把變動送進既有的 KMS scanout 路徑

#### `glXSwapBuffers()` 讓 DRI／`drisw` 將 pixels 交給 Xorg

這個 frame 已經留在 Mesa client-side color buffer。 `glxgears` 呼叫 `glXSwapBuffers(dpy, win)` 時，`win` 仍是 `twm` reparent 以前建立的 application Window XID。 Swap 會沿用 setup 階段建立的 drawable、Mesa color buffer 與 Xorg display storage，把已經算好的 pixels 交給該 X11 drawable

前面的 GBM allocation path 已經介紹 DRI 如何銜接 Mesa driver 與 window system。 現在進入的是 DRI software frontend `drisw`：softpipe 負責「怎麼算出 pixels」，`drisw` 則負責「怎麼把算好的 pixels 交給 X11 drawable」。 Context 與 drawable setup 階段已經建立好這條 DRI loader callback 路徑，`glXSwapBuffers()` 只需要沿既有 objects 完成這一幀的 pixel handoff：

```callgraph
Mesa GLX：從 glXSwapBuffers() 進入 drisw
=================================================
[Mesa: src/glx/glxcmds.c:654] glXSwapBuffers(...)
  │
  └─ gc->vtable->swap_buffers(dpy, drawable)
       │
       │  [Mesa: src/glx/drisw_glx.c:464-472]
       │  drisw_context_vtable.swap_buffers = __glXSwapBuffers
       ↓
[Mesa: src/glx/glxcmds.c:669] __glXSwapBuffers(...)
  │
  ├─ pdraw = GetGLXDRIDrawable(dpy, drawable)
  └─ pdraw->psc->driScreen.swapBuffers(...)
       │
       │  [Mesa: src/glx/drisw_glx.c:665]
       │  driswCreateScreen() 將 callback 註冊成 driswSwapBuffers
       ↓
[Mesa: src/glx/drisw_glx.c:556] driswSwapBuffers(...)
  ├─ 需要 flush 時先 CALL_Flush(...)
  └─ driSwapBuffers(pdraw->dri_drawable)
       ↓
[Mesa: src/gallium/frontends/dri/dri_util.c:869] driSwapBuffers(...)
  │
  └─ drawable->swap_buffers(drawable)
       │
       │  [Mesa: src/gallium/frontends/dri/drisw.c:593]
       │  callback 註冊成 drisw_swap_buffers
       ↓
[Mesa: src/gallium/frontends/dri/drisw.c:276] drisw_swap_buffers(...)
  ↓
[Mesa: src/gallium/frontends/dri/drisw.c:226] drisw_swap_buffers_with_damage(...)
  ├─ ptex = drawable->textures[ST_ATTACHMENT_BACK_LEFT]
  ├─ st_context_flush(..., ST_FLUSH_FRONT, ...)
  ├─ 等待 rendering fence 完成
  └─ drisw_copy_to_front(..., ptex, 0, NULL)
       │
       │  nboxes = 0，這次交付完整的 back-left image
       ↓
[Mesa: src/gallium/frontends/dri/drisw.c:211] drisw_copy_to_front(...)
  ↓
[Mesa: src/gallium/frontends/dri/drisw.c:191] drisw_present_texture(...)
  │
  └─ screen->base.screen->flush_frontbuffer(...)
       │
       │  [Mesa: src/gallium/drivers/softpipe/sp_screen.c:461]
       │  softpipe 將 callback 註冊成 softpipe_flush_frontbuffer
       ↓

softpipe 與 DRI software winsys：將 pixels 交給 loader
=================================================
[Mesa: src/gallium/drivers/softpipe/sp_screen.c:407]
softpipe_flush_frontbuffer(...)
  │
  └─ winsys->displaytarget_display(...)
       │
       │  [Mesa: src/gallium/winsys/sw/dri/dri_sw_winsys.c:427]
       │  DRI software winsys 將 callback 註冊成
       │  dri_sw_displaytarget_display
       ↓
[Mesa: src/gallium/winsys/sw/dri/dri_sw_winsys.c:350]
dri_sw_displaytarget_display(...)
  │
  │  nboxes == 0，使用整張 image 的交付分支
  ├─ display target 有有效 shmid
  │    └─ dri_sw_ws->lf->put_image_shm(...)
  │         │
  │         │  [Mesa: src/gallium/frontends/dri/drisw.c:583]
  │         │  drisw_shm_lf.put_image_shm = drisw_put_image_shm
  │         ↓
  │       [Mesa: src/gallium/frontends/dri/drisw.c:181]
  │       drisw_put_image_shm(...)
  │         ↓
  │       [Mesa: src/gallium/frontends/dri/drisw.c:85] put_image_shm(...)
  │         ├─ loader version > 4 且有 putImageShm2
  │         │    └─ loader->putImageShm2(...)
  │         └─ 否則
  │              └─ loader->putImageShm(...)
  │
  └─ display target 沒有有效 shmid
       └─ dri_sw_ws->lf->put_image(...)
            │
            │  [Mesa: src/gallium/frontends/dri/drisw.c:575]
            │  drisw_lf.put_image = drisw_put_image
            ↓
          [Mesa: src/gallium/frontends/dri/drisw.c:166] drisw_put_image(...)
            ↓
          [Mesa: src/gallium/frontends/dri/drisw.c:64] put_image(...)
            └─ loader->putImage(...)
  ↓
__DRIswrastLoaderExtension::putImage* callback boundary
  ↓

Mesa GLX swrast loader：將 loader callback 轉成 Xlib operation
=================================================
[Mesa: src/glx/drisw_glx.c:366-388] swrast loader extension tables
  ├─ putImage = swrastPutImage
  ├─ putImageShm = swrastPutImageShm
  └─ putImageShm2 = swrastPutImageShm2
       ↓
[Mesa: src/glx/drisw_glx.c:235-289] swrastPutImage*(...)
  ↓
[Mesa: src/glx/drisw_glx.c:200] swrastXPutImage(...)
  │
  ├─ 尚未建立 XImage，或傳入的 shmid 已改變
  │    ↓
  │  [Mesa: src/glx/drisw_glx.c:70] XCreateDrawable(...)
  │    ├─ shmid >= 0：嘗試 XShmCreateImage() 與 XShmAttach()
  │    └─ XShm 無法使用或 attach 失敗：
  │         ├─ pdp->shminfo.shmid = -1
  │         └─ 改以 XCreateImage() 建立一般 XImage
  │
  ├─ pdp->shminfo.shmid >= 0
  │    ├─ XShmPutImage(...)
  │    └─ XSync(...)
  └─ 否則
       └─ XPutImage(...)
            │
            │  target 是 glxgears application Window 的 XID
            ↓
X11 PutImage／ShmPutImage request 進入 Xorg
```

Mesa 呼叫 `XPutImage()` 或 `XShmPutImage()` 時，已經把 color buffer 交到 X11 protocol boundary。 一般 `XPutImage()` 只把 request 排入 connection。 XShm 路徑後面的 `XSync()` 會等待 X server 處理同步 request，但不會把後續 `DIRTYFB`、virtio-gpu commands 與 SDL present 變成 `glXSwapBuffers()` 內的同步函式鏈

Xorg 的 event loop 稍後從 connection 取出 request。 本文的完整 image handoff 會讓 core `PutImage` 與 MIT-SHM `ShmPutImage` 分支匯合到 GC 的 `PutImage` operation，再經 Damage wrapper 與 framebuffer implementation 寫入 display storage：

```callgraph
Xorg：在 server event loop 處理 X11 image request
=================================================
core PutImage request
  │
  ↓
[Xorg: dix/dispatch.c:2161]
int ProcPutImage(ClientPtr client)
  │
  ├─ VALIDATE_DRAWABLE_AND_GC(...)
  ├─ 驗證 format、depth 與 request length
  └─ pGC->ops->PutImage(pDraw, pGC, ..., tmpImage)

MIT-SHM ShmPutImage request
  │
  ↓
[Xorg: Xext/shm.c:484]
static int ShmPutImage(ClientPtr client,
                       xShmPutImageReq *stuff)
  │
  ├─ VALIDATE_DRAWABLE_AND_GC(...)
  ├─ 本例交付完整 image，使用直接 PutImage 分支
  └─ pGC->ops->PutImage(pDraw, pGC, ...,
                         shmdesc->addr + offset)

兩條 request path 都進入 GC PutImage operation
  │
  ↓
[Xorg: miext/damage/damage.c:721]
static void damagePutImage(DrawablePtr pDrawable, GCPtr pGC, ...)
  │
  ├─ 以 pGC->pCompositeClip->extents 修剪 bounding box
  ├─ damageDamageBox(...)
  ├─ pGC->ops->PutImage(...)
  │    ↓
  │  [Xorg: fb/fbimage.c:30]
  │  void fbPutImage(DrawablePtr pDrawable, GCPtr pGC, ...)
  │    ├─ x += pDrawable->x，y += pDrawable->y
  │    └─ fbPutZImage(..., fbGetCompositeClip(pGC), ...)
  │         // 只寫入 composite clip 允許的範圍
  └─ damageRegionProcessPending(pDrawable)
```

Xorg 會以 Window origin 將 Window-local 座標轉成 X Screen 座標，套用 composite clip，再將仍然可見的矩形寫入 screen Pixmap 與 mapped front BO 共用的既有 display storage。 這個 server-side request 處理完成後，下一個問題是如何讓正在 scanout 的 virtio-gpu 2D resource 取得這些新 pixels

#### `DIRTYFB` 讓更新後的 screen storage 進入 scanout

此時 Xorg 已經持有 front BO，對應的既有 KMS framebuffer 也正綁在 active primary plane 上。 本節從這組持續使用中的 display state 開始，追蹤 Xorg 如何以 `DIRTYFB` 將 runtime damage 交給 kernel display path

Xorg 處理 handoff 產生的 `PutImage` request、改寫 screen Pixmap 後，Damage tracking 會記錄需要發布的變動範圍。 `damagePutImage()` 先以 GC composite clip 的 extents 縮小 PutImage bounding box，再把結果併入 Damage Region。 Damage Region 因此是 Xorg 必須通知 display path 的保守範圍，不是 application Window `clipList` 中每個可見矩形的一對一副本

Dirty tracking 啟用時，`msBlockHandler()` 會呼叫 `dispatch_dirty()`。 後面的 `dispatch_damages()` 會先把 Damage Region 轉成目前 CRTC 可使用的 clip rectangles，只有至少留下一個 rectangle 時才呼叫 `drmModeDirtyFB()`。 這個 ioctl 讓既有 KMS framebuffer 進入 atomic dirty update，再由 virtio-gpu primary plane 把 pixels 傳給 host-side 2D resource：

以下 callgraph 從 Xorg 已經收到 pixels 開始。 它固定追蹤 virtio-gpu framebuffer 實作的 `dirty` callback，並看到 DRM atomic helper 如何把 dirty rectangles 放進 primary plane state：

```callgraph
Xorg modesetting：將 screen damage 轉成 DIRTYFB clips
=================================================
[Xorg: hw/xfree86/drivers/video/modesetting/driver.c:930]
static void msBlockHandler(ScreenPtr pScreen, void *timeout)
  │
  └─ if (ms->dirty_enabled)
       dispatch_dirty(pScreen)
       ↓
[Xorg: hw/xfree86/drivers/video/modesetting/driver.c:776]
static void dispatch_dirty(ScreenPtr pScreen)
  ├─ pixmap = pScreen->GetScreenPixmap(pScreen)
  ├─ drmmode_crtc_get_fb_id(crtc, &fb_id, &x, &y)
  └─ dispatch_dirty_region(..., ms->damage, fb_id, x, y)
       ↓
[Xorg: hw/xfree86/drivers/video/modesetting/driver.c:635]
static int dispatch_damages(..., RegionPtr dirty, ..., int fb_id, ...)
  │
  ├─ Region 為空，或 rectangles 經 CRTC transform／clip 後全數無效
  │    └─ 不送出 ioctl
  └─ Region 非空
       ├─ 將 Region rectangles 轉成 drmModeClip[]
       └─ drmModeDirtyFB(ms->fd, fb_id, clip, count)
            ├─ -EINVAL：逐一重送 clip
            │    └─ 仍為 -EINVAL：停用後續 dirty updates
            ├─ -ENOSYS：停用後續 dirty updates
            └─ success
                 │
                 │  // libdrm 已送出 DRM_IOCTL_MODE_DIRTYFB
                 ↓

Linux DRM core：從 framebuffer ID 找到 dirty callback
=================================================
[Linux: drivers/gpu/drm/drm_framebuffer.c:711]
int drm_mode_dirtyfb_ioctl(struct drm_device *dev,
                           void *data,
                           struct drm_file *file_priv)
  │
  ├─ fb = drm_framebuffer_lookup(dev, file_priv, request->fb_id)
  ├─ copy_from_user(clips, clips_ptr, ...)
  └─ fb->funcs->dirty(fb, file_priv, flags,
                            color, clips, num_clips)
       │
       │  // virtio_gpu_fb_funcs.dirty = drm_atomic_helper_dirtyfb
       ↓

DRM atomic helper：將 damage 放進 primary plane state
=================================================
[Linux: drivers/gpu/drm/drm_damage_helper.c:109]
int drm_atomic_helper_dirtyfb(struct drm_framebuffer *fb, ...)
  ├─ state = drm_atomic_commit_alloc(fb->dev)
  ├─ convert_clip_rect_to_rect(clips, rects, ...)
  ├─ damage = drm_property_create_blob(..., rects)
  │
  ├─ drm_for_each_plane(plane, fb->dev)
  │    ├─ 只選擇 plane->state->fb == fb 的 planes
  │    │    // 本例的 front framebuffer 正綁在 primary plane
  │    ├─ plane_state = drm_atomic_get_plane_state(state, plane)
  │    └─ drm_property_replace_blob(
  │             &plane_state->fb_damage_clips, damage)
  │
  └─ drm_atomic_commit(state)
       ↓
[Linux: drivers/gpu/drm/drm_atomic.c:1774]
drm_atomic_commit(state)
  ├─ drm_atomic_check_only(state)
  │    └─ validation 失敗：回傳錯誤，不更新 plane
  └─ validation 成功：mode_config.funcs->atomic_commit(...)
       │  // virtio_gpu 註冊 drm_atomic_helper_commit
       ↓
[Linux: drivers/gpu/drm/drm_atomic_helper.c:2245]
drm_atomic_helper_commit(...)
  └─ commit_tail(state)
       ↓
[Linux: drivers/gpu/drm/drm_atomic_helper.c:1983]
drm_atomic_helper_commit_tail(state)
  └─ drm_atomic_helper_commit_planes(dev, state, 0)
       └─ primary plane funcs->atomic_update(plane, state)
            ↓
[Linux: drivers/gpu/drm/virtio/virtgpu_plane.c:235]
virtio_gpu_primary_plane_update(plane, state)
```

`virtio_gpu_primary_plane_update()` 是 KMS plane state 真正變成 virtio-gpu 2D commands 的位置。 以下片段來自 [`Linux: drivers/gpu/drm/virtio/virtgpu_plane.c:235`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/drivers/gpu/drm/virtio/virtgpu_plane.c?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n235)，用來區分每次的 pixel transfer，以及只在 scanout state 變更時才會重新發出的 `SET_SCANOUT`：

```c
// [Linux: drivers/gpu/drm/virtio/virtgpu_plane.c:235]
static void
virtio_gpu_primary_plane_update(struct drm_plane *plane,
                                struct drm_atomic_commit *state)
{
    struct drm_plane_state *old_state =
        drm_atomic_get_old_plane_state(state, plane);
    struct virtio_gpu_device *vgdev = plane->dev->dev_private;
    struct virtio_gpu_output *output = NULL;
    struct virtio_gpu_object *bo;
    struct drm_rect rect;
    ...

    if (plane->state->crtc)
        output = drm_crtc_to_virtio_gpu_output(plane->state->crtc);
    if (old_state->crtc)
        output = drm_crtc_to_virtio_gpu_output(old_state->crtc);
    if (WARN_ON(!output))
        return;

    if (!plane->state->fb || !output->crtc.state->active) {
        virtio_gpu_cmd_set_scanout(vgdev, output->index, 0,
                                   plane->state->src_w >> 16,
                                   plane->state->src_h >> 16,
                                   0, 0);
        virtio_gpu_notify(vgdev);
        return;
    }

    if (!drm_atomic_helper_damage_merged(old_state, plane->state, &rect))
        return;

    bo = gem_to_virtio_gpu_obj(plane->state->fb->obj[0]);
    if (bo->dumb)
        virtio_gpu_update_dumb_bo(vgdev, plane->state, &rect);

    if (plane->state->fb != old_state->fb ||
        plane->state->src_w != old_state->src_w ||
        plane->state->src_h != old_state->src_h ||
        plane->state->src_x != old_state->src_x ||
        plane->state->src_y != old_state->src_y ||
        output->needs_modeset) {
        output->needs_modeset = false;
        ...
        virtio_gpu_cmd_set_scanout(vgdev, output->index,
                                   bo->hw_res_handle,
                                   plane->state->src_w >> 16,
                                   plane->state->src_h >> 16,
                                   plane->state->src_x >> 16,
                                   plane->state->src_y >> 16);
    }

    virtio_gpu_resource_flush(plane,
                              rect.x1, rect.y1,
                              rect.x2 - rect.x1,
                              rect.y2 - rect.y1);
}
```

如果 framebuffer 已解除綁定，或 CRTC 已經 inactive，第一個分支會用 resource ID 0 停用 scanout，接著結束這次 update

Display state 仍然 active 時，`drm_atomic_helper_damage_merged()` 才把新舊 plane state 中的 damage 合併成 `rect`。 沒有 damage 就直接返回

因為本例的 GEM object 是 dumb BO，`virtio_gpu_update_dumb_bo()` 會將 `TRANSFER_TO_HOST_2D` 排入 control virtqueue，要求 host 把這個矩形的 guest backing pixels 複製到 host-side 2D resource

同一個 framebuffer、source rectangle 與 CRTC 持續使用時，`if` 條件不成立，因此通常不會每幀重送 `SET_SCANOUT`。 這個 command 在初次 modeset、framebuffer 切換或 source rectangle 改變時更新 resource-to-scanout binding。 `RESOURCE_FLUSH` 則在每次有效 damage update 的尾端發出，通知 host 把已更新的 resource 內容發布到目前綁定的 scanout

最後跨出 guest kernel boundary，semu 的 2D device backend 會依三種 commands 各自完成一項工作：

```callgraph
semu virtio-gpu 2D device backend
=================================================
Linux 送入 control virtqueue 的 commands
  │
  ├─ [semu: virtio-gpu-sw.c:823]
  │  vgpu_sw_cmd_transfer_to_host_2d_handler(...)
  │    └─ vgpu_sw_copy_image_from_pages(request, resource)
  │         // 將 guest backing pages 的 damage rectangle 複製進 host 2D image
  │
  ├─ 只在 scanout binding 變更時：
  │  [semu: virtio-gpu-sw.c:626]
  │  vgpu_sw_cmd_set_scanout_handler(...)
  │    └─ 在 scanouts[scanout_id] 記錄 resource ID 與 source rectangle
  │         // 這是 display binding，不搬運 pixels
  │
  └─ [semu: virtio-gpu-sw.c:737]
       vgpu_sw_cmd_resource_flush_handler(...)
         ├─ scanout 未啟用或未綁定此 resource
         │    └─ 跳過該 scanout
         ├─ display backend unavailable 或 display queue 已滿
         │    └─ 捨棄這次畫面發布，保留上一幀
         ├─ payload 配置失敗
         │    └─ 捨棄這次畫面發布，保留上一幀
         └─ [semu: vgpu-display.c:226]
              vgpu_display_publish_primary_set(scanout_id, payload)
                │
                │  // 只將 PRIMARY_SET command 排入 display queue
                ↓

semu SDL display backend：在 event loop 中消費 display queue
=================================================
[semu: window-sw.c:387] window_drain_display_queue()
  │
  ├─ vgpu_display_pop_cmd(&cmd)
  └─ VGPU_DISPLAY_CMD_PRIMARY_SET
       └─ [semu: window-sw.c:268]
          sdl_plane_info_update_texture(...)
            ├─ SDL_UpdateTexture(texture, NULL, pixels, stride)
            └─ upload 成功後標記 scanout 需要重新 render
       ↓
[semu: window-sw.c:372] sdl_scanout_render(...)
  ├─ SDL_RenderCopy(...)
  └─ SDL_RenderPresent(...)
       ↓
使用者在 SDL window 看見新的齒輪角度
```

當 scanout 仍綁定該 resource，且 payload 建立成功時，semu 會擷取 `SET_SCANOUT` 所記錄的完整 source view，再把這份 snapshot 排入 display queue。 這個 flush rectangle 不會再次裁切 payload。 Linux `virtio_gpu` driver 收到 flush command 的 response 時，畫面仍可能只停在佇列中。 等 SDL event loop 成功更新 texture 並執行 `SDL_RenderPresent()`，使用者才會看見新內容

## 一幀畫面的 pixel storage 與交付路徑

前一節沿著函式與 request 的先後順序，追蹤 `glxgears` 的一幀畫面如何從 Mesa 走到本例的 SDL window。 現在把觀察重點移到流程中持續存在的 objects 與 storage：哪些 objects 真正持有 pixels、哪些 objects 只保存 reference 或座標關係，以及 `glXSwapBuffers()` 前後何時會複製 pixel data。 這些關係會說明 Mesa client-side color buffer 與 Xorg screen Pixmap／front BO 為何是兩份 storage，也能分辨同一份底層 storage 被多個 objects 引用的情況

本節分三輪觀察同一幀畫面。 第一輪確認每個 object 對應哪份 storage，第二輪追蹤每一幀的 pixel handoff，第三輪再把這些 objects 與動作放回從 device probe 到 `DIRTYFB` 的完整生命週期

### 兩份 guest-side pixel storage

齒輪尚未畫出前，Xorg 已經必須保存完整桌面，Mesa 則要為即將產生的結果取得一份可寫入的 color buffer

先確認兩件事：Xorg 把目前桌面保存在哪裡，以及 application Window 如何對映到那份既有 storage。 接著再加入 Mesa client-side color buffer，才能在 swap 與 dirty update 出現時分辨 pixels 正從哪裡移到哪裡

#### Xorg screen `PixmapRec` 與 mapped front BO

使用者尚未啟動 `glxgears` 時，Xorg 已經需要一份 storage 保存背景、既有的終端機、時鐘與 `twm` decorations。 第一張圖先不加入 application-specific objects，只追蹤這份完整 X Screen content 如何從 Xorg `PixmapRec` 連到 DRM／KMS 與 virtio-gpu

先回答兩個問題：

1. Xorg 用哪個 object 保存目前的完整桌面？
2. 這個 object 又如何連到 DRM／KMS 與 virtio-gpu 使用的顯示 resource？

![Object 第 1 階段：Xorg screen Pixmap 映射 front BO storage，KMS framebuffer 保存 GEM object reference](./image/glx-object-stage-1-xorg-display-storage.png)

首先我們來看 Xorg screen 的 `PixmapRec`。 screen Pixmap 是 X server 用來表示整個 X Screen 內容的 storage object。 以下程式碼來自 [`Xorg: include/pixmapstr.h:75`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/include/pixmapstr.h#L75-L86) 的 `PixmapRec` 定義，用來確認這個 object 如何描述 pixel storage：

```c
// [Xorg: include/pixmapstr.h:75-86]
typedef struct _Pixmap {
    DrawableRec drawable;
    PrivateRec *devPrivates;
    int refcnt;
    int devKind;                /* This is the pitch of the pixmap, typically width*bpp/8. */
    DevUnion devPrivate;        /* When !NULL, devPrivate.ptr points to the raw pixel data. */
    ...
} PixmapRec;
```

其中 `drawable` 用來記錄這份 Pixmap 的尺寸、color depth 與所屬 Screen，`devKind` 用來記錄每一列 pixels 的 pitch。 在本文的組態中，`devPrivate.ptr` 最後會指向 front BO 的 CPU mapping，讓 X server 能透過 `PixmapRec` 找到整個 X Screen 的 pixel storage

接著是 Xorg 透過 GBM 持有的 mapped front BO。 它在 Xorg 端的型態是 `struct gbm_bo *`，指向 Mesa `libgbm` 建立的 userspace object。 這個 object 用來保存 buffer 的寬度、高度、format、stride 與 handle，並連回建立這份 buffer 的 `gbm_device`

Xorg 確實會 include Mesa 安裝的公開 `gbm.h`，也會在建置與執行期 link `libgbm`。 公開 header 只把 `struct gbm_device`、`struct gbm_bo` 與 `struct gbm_surface` 宣告成 opaque types。 Xorg 可以保存 pointer 並呼叫 `gbm_bo_get_*()`、`gbm_bo_map()` 與 `gbm_bo_destroy()`，卻不能解參考私有欄位

下方完整 layout 來自 Mesa backend ABI，用來解釋這個 pointer 傳入 `libgbm` 後所指向的 object。 它不是 Xorg 可直接使用的公開 struct definition

以下片段分別來自 [`Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.h:9`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/drmmode_bo.h#L9) 與 [`Mesa: src/gbm/main/gbm.h:46`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm.h#L46-48)，用來顯示 Xorg include 的正是 GBM 公開 header，而公開 header 只提供 opaque declarations：

```c
// [Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.h:9]
#include <gbm.h>

...

// [Mesa: src/gbm/main/gbm.h:46]
struct gbm_device;
struct gbm_bo;
struct gbm_surface;
```

:::tip
GBM 的全名是 Generic Buffer Manager。 在 [`Mesa: src/gbm/main/gbm.h:41`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm.h#L41-58) 的定義中，它提供一層抽象，用來向平台底層的 memory manager 請求 buffer。 GBM 是 Mesa 專案提供的 userspace 函式庫，GBM backend 也是 userspace 實作

Linux kernel 公開 DRM device node 與 UAPI。 Xorg 開啟 device node 取得 fd，GBM backend 透過這個 fd 配置、匯入、匯出或 mapping buffer。 Xorg 另外透過 libdrm 與同一個 DRM device fd 建立 KMS framebuffer，並設定 display state

呼叫端會將 DRM fd、尺寸、pixel format 與 `GBM_BO_USE_SCANOUT`、`GBM_BO_USE_WRITE` 等用途交給 GBM。 GBM backend 會配置符合需求的 buffer，再回傳 `struct gbm_bo`。 呼叫端可透過 GBM API 查詢 stride、handle 與 modifier，也可以要求 CPU mapping 或匯出 dma-buf fd。 後文「Loader、DRI 與 libgbm」會再沿原始程式碼詳細展開 `gbm_device`、`gbm_bo` 與 `gbm_surface`
:::

以下程式碼來自 [`Mesa: src/gbm/main/gbm_backend_abi.h:180`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm_backend_abi.h#L180-201) 的 GBM backend ABI，用來確認 `struct gbm_bo` 在 userspace 中保存的基本資料：

```c
// [Mesa: src/gbm/main/gbm_backend_abi.h:180-201]
struct gbm_bo_v0 {
   uint32_t width;
   uint32_t height;
   uint32_t stride;
   uint32_t format;
   union gbm_bo_handle handle;
   void *user_data;
   ...
};

...

struct gbm_bo {
   struct gbm_device *gbm;
   struct gbm_bo_v0 v0;
};
```

Xorg 的 modesetting driver 會把這個 pointer 保存在 `drmmode_rec` 的 `front_bo`。 以下片段來自三個位置：

- [`Xorg: drmmode_display.h:78`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/drmmode_display.h#L78-L94)：宣告 `drmmode_rec` 持有的 GBM device 與 front BO
- [`Xorg: driver.c:1722`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/driver.c#L1722-L1756)：取出 CPU mapping，再交給 screen Pixmap
- [`Xorg: mi/miscrinit.c:116`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/mi/miscrinit.c#L116-L120)：將 mapping 位址寫入 `PixmapRec` 的 `devPrivate.ptr`

這三段程式碼顯示 Xorg 如何持有 front BO pointer，再讓 screen Pixmap 借用它的 CPU mapping：

```c
// [Xorg: hw/xfree86/drivers/video/modesetting/drmmode_display.h:78]
typedef struct {
    int fd;
    ...
    struct gbm_device *gbm; // declaration from gbm.h in Mesa
    ...
    struct gbm_bo *front_bo;
    ...
} drmmode_rec, *drmmode_ptr;

...

// [Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1722]
static Bool
modesetCreateScreenResources(ScreenPtr pScreen)
{
    ScrnInfoPtr pScrn = xf86ScreenToScrn(pScreen);
    modesettingPtr ms = modesettingPTR(pScrn);
    PixmapPtr rootPixmap;
    void *pixels = NULL;
    ...

    if (!ms->drmmode.glamor)
        pixels = gbm_bo_get_map(ms->drmmode.front_bo);

    rootPixmap = pScreen->GetScreenPixmap(pScreen);
    ...
    pScreen->ModifyPixmapHeader(rootPixmap, -1, -1, -1, -1, -1, pixels);
    ...
}

...

// [Xorg: mi/miscrinit.c:64]
Bool
miModifyPixmapHeader(PixmapPtr pPixmap, int width, int height, int depth,
                     int bitsPerPixel, int devKind, void *pPixData)
{
    ...
    if (pPixData)
        pPixmap->devPrivate.ptr = pPixData;
    ...
    return TRUE;
}
```

同一個 `front_bo` 會跨過三個持有與引用層次。 Xorg modesetting 把 pointer 保存於 `drmmode_rec::front_bo`，並呼叫 GBM API 管理它的生命週期。 Pointer 指向的 `struct gbm_bo` 是 Mesa `libgbm` 實作的 userspace object

在本文選定的 `DRM_IOCTL_MODE_CREATE_DUMB` 分支中，底層 storage 是 Linux DRM 建立的 GEM dumb BO。 KMS framebuffer 與 virtio-gpu 2D resource 則繼續引用這份 storage

```text
Xorg modesetting
  │
  │  drmmode_rec::front_bo
  │  保存 pointer，呼叫 GBM API 建立、map 與釋放
  ↓
Mesa libgbm
  │
  │  struct gbm_bo userspace object
  │  保存尺寸、stride、format、handle 與 backend operations
  ↓
Linux DRM
  │
  │  scanout-capable BO backing storage
  ↓
KMS framebuffer reference
```

Screen `PixmapRec` 與 front BO 指向同一份 pixel storage。 `PixmapRec` 描述 X server 看到的 drawable storage，`devPrivate.ptr` 則借用 front BO 的 CPU mapping。 後面加入的 Mesa client-side color buffer 才是另一份獨立 storage

由於本文將 `AccelMethod` 設為 `none`，所以 `gbm_create_best_bo()` 會要求一份可供 CPU mapping 的 front BO。 Xorg-local `gbm_bo_get_map()` helper 取出先前由公開 `gbm_bo_map()` 建立的 mapping 位址，`miModifyPixmapHeader()` 再將這個位址寫入 screen `PixmapRec` 的 `devPrivate.ptr`。 後面不論哪個 Window 產生新內容，X server 最後都要讓這份 screen storage 反映可見結果

Xorg 另外建立一個引用這份 BO 的 KMS framebuffer，`fb_id` 用來識別該 framebuffer。 Primary plane 以 `FB_ID` 選取 framebuffer，再以 `CRTC_ID` 接到 scanout pipeline。 本例未協商 `VIRTIO_GPU_F_RESOURCE_BLOB`，因此 BO 建立時會走傳統的 `RESOURCE_CREATE_2D`／`RESOURCE_ATTACH_BACKING` 分支。 圖中的 objects 依序保存 pointer、handle 或 object reference，並未因此產生額外的 pixel copy

#### 未 redirect Window 對映到 screen storage

前一節已建立 frame、title 與 application Window 的 Window tree，也說明 reparent 不會改變 application Window 的 XID。 因此 `glXSwapBuffers()` 仍指定 application Window，不會改成把 pixels 交給 `twm` frame Window

![Object 第 2 階段：X11 Window／Drawable 與 screen Pixmap storage mapping](./image/glx-object-stage-2-x11-window-storage.png)

在本文的固定路徑中，Root Window、`twm` frame、title 與 application Window 都維持 `RedirectDrawNone`。 它們各自保存 hierarchy、geometry、origin 與可見範圍，但 `GetWindowPixmap()` 最後都解析到已安裝的 screen Pixmap。 Screen `PixmapRec::devPrivate.ptr` 又指向 mapped front BO，因此這些 Windows 描述的是同一份 screen storage 中的不同區域，而不是各自配置一份 pixels

交付 `PutImage` 類 request 時，X server 以 application Window 為 drawable。 它先將 Window-local destination 加上 screen origin，再以 Window 的 visible region 與 GC／client clip 得到的 composite clip 限制寫入範圍

可寫的矩形直接更新 screen Pixmap／front BO。 被其他 Window 遮住的部分不會覆寫目前桌面內容

#### Mesa client-side color buffer

此時 server 端已經知道 request 要寫入哪一份 storage，也知道 `twm` frame 底下的 application Window 位於螢幕哪裡。 Application 端仍缺少供軟體 renderer 寫入的 color buffer。 下一張圖要補上第二份 guest-side pixel storage

guest CPU 算出的 pixels 在 swap 前由誰保存？ Mesa 要把哪一份 client-side storage 的內容交給 X server，才能更新剛才的 drawable？

![Object 第 3 階段：Mesa client-side color buffer、X11 drawable 與 Xorg front BO](./image/glx-object-stage-3-mesa-client-buffer.png)

第三列加入 Mesa client-side color buffer。 軟體 renderer 以 guest CPU 執行 OpenGL work，完成的 pixels 先寫入這份 buffer。 它位於 application／Mesa 一側，由 DRI 軟體 winsys 建立軟體 display target 及其 userspace backing，因此 rendering 期間不需要先把每個 draw 送進 virtio-gpu

這份 userspace backing 不一定要透過一般的 heap memory 配置取得。 DRI 軟體 winsys 若能使用 SHM put-image callback，會優先配置 SysV SHM segment。 配置失敗或 callback 不可用時，才改用 aligned heap memory

前一種情況下，softpipe 直接把 pixels 寫進之後交給 `XShmPutImage()` 引用的同一個 segment，不需要先複製到另一份專供 XShm 使用的 buffer

`drisw` 保存 drawable 所需的連結，讓 Mesa 在 swap 時能把這份 color buffer 的 pixel range 交給正確的 X11 目標。 X server 處理 request 時，使用 Window origin 與 GC composite clip，直接把可寫部分放進 screen Pixmap／front BO

Mesa client-side color buffer 在 swap 時保存要交付的 `glxgears` pixel range。 screen Pixmap／front BO 保存的則是整個 X Screen 目前可見的結果。 在本文未 redirect 的路徑中，swap 只會把 GC composite clip 允許的矩形寫進 screen Pixmap，因此兩份 storage 可能同時保存可見區域的相同 pixel values，但 screen Pixmap 不會因此取得被其他視窗遮住的完整齒輪畫面

三張圖至此建立了 storage 與交付目的地的關係：application Window 與既有的 origin／clip state 決定目標、位置與可寫範圍，Mesa client-side color buffer 保存尚未交付的 rendering 結果，screen `PixmapRec`／front BO 則保存 X Screen 的可見結果。 下一節改追一幀畫面如何在兩份 storage 之間移動

### 一幀的交付：rendering、pixel handoff、Window update 與 scanout update

前面的 objects 與 storage 準備完成後，第一幀齒輪畫面也會沿著接下來的路徑出現。 為了看清每次交接，這裡追蹤齒輪轉動後的下一幀畫面：application 更新角度，發出這一幀所需的 OpenGL operations，再呼叫 swap，要求 Xorg 以新的內容更新同一個 Window

使用者只會看到齒輪平順地轉動一小段。 圖形堆疊內部卻要先在 Mesa client-side color buffer 產生 completed pixels，再將它們交給 X server，最後更新 host-side resource。 接下來沿著這一幀的 pixels 往下看，逐步確認每個階段由誰處理，以及完成後畫面停在哪一份 storage

`twm` 已在 application Window 出現前完成 frame Window、位置與 stacking setup。 正常的下一幀齒輪畫面會直接使用 Xorg 保存的既有 Window state，因此以下分成 Rendering、Swap／pixel handoff、Window update 與 Scanout update 四個逐幀動作

#### Rendering：在 Mesa client-side color buffer 產生 pixels

application 發出 OpenGL work 後，第一批 completed pixels 由誰算出，又先寫進兩份 guest-side storage 中的哪一份？

![動作第 1 階段：Rendering 在 application 與 Mesa 區域產生 completed pixels](./image/glx-action-stage-1-rendering.png)

第一個動作是 Rendering。 Application 對 current OpenGL context 發出 OpenGL operation。 softpipe 隨即在 guest CPU 上執行 vertex processing、rasterization 與 fragment processing，再將 pixels 寫入上一輪加入的 Mesa client-side color buffer

softpipe 負責「怎麼算出 pixels」，`drisw` 則負責後續「怎麼把算好的 pixels 交給 X11 drawable」

這個動作的完成條件是 client 行程內已有一份可呈現的 pixel data。 X server 的 drawable、Xorg front BO 與 host resource 都還沒有因此改變，因為 rendering 的 owner 仍在 application／Mesa 一側

#### Swap 與 pixel handoff：把 client-side pixels 交給 X server

要讓這一幀離開 Mesa client-side color buffer，application 必須明確要求交換 drawable 的內容。 下一個動作因此從 swap 開始，處理 Mesa 與 X server 之間的 pixel handoff

Mesa client-side color buffer 已有完整內容後，swap 如何讓 pixels 跨進 X server？ 這次交接實際攜帶的資料又是什麼？

![動作第 2 階段：Swap 透過 put-image-style handoff 把 pixels 交給 X server](./image/glx-action-stage-2-present.png)

第二個動作是 swap 與 pixel handoff。 Application 呼叫 `glXSwapBuffers()` 後，`drisw` 會取出要交付的 pixel range，經 Mesa GLX loader 呼叫 `XPutImage()` 或 `XShmPutImage()`。 libX11／libXext 接著建立 core `PutImage` 或 MIT-SHM `ShmPutImage` wire request

Core `PutImage` request 會攜帶 inline pixel bytes、目標 drawable、座標與尺寸。 MIT-SHM `ShmPutImage` request 則攜帶 shared-memory segment 與 offset reference，再由 X server 讀取對應的 pixels。 這條軟體路徑沒有使用 X Present extension，因此本節以「pixel handoff」描述它，將 `Present` 專名保留給後面 DRI3／Present 路徑

兩條 request 都把 client rendering 結果交到 X server 邊界，但 wire payload 不同。 接下來的 Window update 會處理這一個 request，依 drawable mapping 決定實際寫入的 screen 區域

#### Window update：套用 origin 與 clip

X server 已收到 Window 的 pixels，接下來如何套用 Window 位置與 clip region，讓只有可見內容進入 screen Pixmap／front BO？

![動作第 3 階段：Window update 套用 origin 與 composite clip，更新 screen Pixmap／front BO](./image/glx-action-stage-3-window-server-update.png)

第三個動作是 Window update。 X server 在處理同一個 put-image request 時，加入 Window drawable 的 screen origin，再套用 GC composite clip。 可寫的 pixels 直接進入目前安裝的 screen Pixmap／front BO，更新會在這次 request processing 內完成

Window update 讓 front BO 取得經過 origin 與 clipping 後的 X Screen 可見結果。 Mesa client-side color buffer 仍是另一份 guest-side storage，Window／Drawable 則只提供 request 到 screen storage 的 mapping

#### Scanout update：搬移並發布 dirty pixels

front BO 已在 guest 記憶體中更新，host-side resource 尚未因而自動反映新內容。 要讓本例的 SDL window 看到同一個可見區域，最後一個動作必須把 dirty screen storage 交給 DRM／KMS 與 virtio-gpu

哪些操作把 dirty front BO 搬到 host-side resource，為什麼 `TRANSFER_TO_HOST_2D` 必須先於 `RESOURCE_FLUSH`？

![動作第 4 階段：Scanout update 先搬移 pixels，再發布更新](./image/glx-action-stage-4-scanout-update.png)

第四個動作是 Scanout update。 Xorg modesetting 會以 `drmModeDirtyFB()` 將 front BO 的改動矩形交給 DRM／KMS。 virtio-gpu driver 接著以 `TRANSFER_TO_HOST_2D` 把指定矩形的 pixels 從 guest backing 搬進 host-side 2D resource，再用 `RESOURCE_FLUSH` 要求 host 發布更新。 semu 會為仍綁定該 resource 的 scanout 建立 snapshot 並排入 display queue，SDL event loop 稍後才更新 texture 並呈現這一幀

四個動作已經把一幀畫面從 Mesa client-side color buffer 帶到 host 視窗。 這條路徑仍有一個時間上的問題：DRM device、front BO 與 scanout resource 都早於 application 存在，它們究竟在何時建立？ 第三輪把相同 object 與動作放回 VM 的完整生命週期

### 完整時間線：初始化、Window setup 與逐幀更新

前兩輪分別回答 pixels 存在哪裡，以及一幀畫面如何在這些 storage 之間移動。 最後把 objects 與逐幀動作放回從系統啟動到畫面更新的先後順序，分辨長時間沿用的 display state、application 啟動時建立的 objects，以及每一幀重複執行的工作

以下五張生命週期圖以 owner 與 storage 的大區塊呈現各階段，文字則補上區塊內的事件順序

#### VM boot 與 DRM device probe

VM 剛開機、Xorg 尚未啟動時，guest 必須先建立哪些裝置 object，host 才能告訴它可用的 scanout 資訊？

![GLX 生命週期 第 1 階段：VM boot 與 DRM device probe](./image/glx-lifecycle-stage-1-device-probe.png)

生命週期的第 1 階段是 VM boot 與 device probe。 Linux virtio-gpu driver 探測裝置後建立 DRM device 與 KMS objects，讓 guest 有能力表示 connector、CRTC、plane 與後續 framebuffer state。 使用者執行 `startx` 後，Xorg modesetting driver 會再開啟這個 DRM device，讀取既有的 KMS resources，並選出要建立 X Screen 的顯示裝置。 此時 application、Mesa context 與 Xorg front BO 都還不存在

virtio-gpu driver 先從 device config 取得 scanout 數量，再以 `GET_DISPLAY_INFO` 取得並記錄各 scanout 的尺寸，以及是否啟用。 Host 端由本例設定的 SDL2 display backend 承接最終顯示，畫面仍等待 guest 指定實際的 scanout resource。 此時 display topology 已可供 DRM／KMS 表示，還沒有可顯示的 pixels

device probe 完成後，guest 已知道顯示端能提供什麼，卻沒有一份 X Screen storage 可交給 scanout。 下一階段由 modesetting `ScreenInit()` 配置 front BO，準備 Root Window 與 connection setup reply，再進入 event loop 執行第一次 modeset

#### Xorg 建立 display storage，進入 `Dispatch()` 後綁定 scanout

Xorg 在什麼時候建立 front BO，又為何要等到進入 `Dispatch()` 後，才讓 KMS framebuffer 與 scanout 引用這份 storage？

![GLX 生命週期第 2 階段：Xorg 建立 display storage，完成 connection setup 後再綁定 initial scanout](./image/glx-lifecycle-stage-2-startx-display-setup.png)

第 2 階段從 modesetting `ScreenInit()` 開始。 Xorg 會為整個 X Screen 建立可供 CPU mapping 的 GBM front BO。 本文選定的 `GBM_BO_USE_WRITE | GBM_BO_USE_SCANOUT` 分支由 Mesa `create_dumb()` 送出 `DRM_IOCTL_MODE_CREATE_DUMB`，底層則建立傳統的 virtio-gpu 2D resource 與 guest backing

`ScreenInit()` 完成後，Xorg 建立 Root Window，並將 `xWindowRoot`、`xDepth` 與 `xVisualType` 編碼成 connection setup reply。 `NotifyParentProcess()` 此時會用 SIGUSR1 喚醒 `xinit`，但 `waitforserver()` 的 `XOpenDisplay()` 還要等 Xorg 進入 event loop，才能完成 setup exchange

Xorg 接著進入 `Dispatch()`。 第一次 `WaitForSomething()` 執行 one-shot BlockHandler 時，modesetting 才建立引用 front BO storage 的 KMS framebuffer，並送出 initial `SETCRTC`。 virtio-gpu primary-plane update 會以 `SET_SCANOUT` 將同一個 2D resource 綁到既有的 KMS topology。 Host 收到 `SET_SCANOUT` 後，便知道本例的 SDL window 要觀看哪個 resource

front BO、KMS framebuffer 與 resource-to-scanout binding 都會跨越後續多幀。 一般的畫面更新只改變 resource 內容，不需要在每次 swap 時重新選擇 scanout

#### `XOpenDisplay()` 成功後，`xinitrc` 與 `twm` 建立 session

Xorg 進入 event loop 後，`waitforserver()` 的 `XOpenDisplay()` 可以完成 connection setup。 `xinit` 隨後執行 system `xinitrc`，啟動 `twm`、`xclock` 與 `xterm`。 `twm` 會在 Root Window 選取 `SubstructureRedirectMask`，取得管理後續頂層 application Windows 的 Window Manager 角色

使用者之後從 `xterm` 執行 `glxgears`。 這個時間點以前，X Screen storage、KMS scanout state 與 `twm` 的管理角色都已存在。 `glxgears` 的 application Window、frame／title Windows、GLX context 與 Mesa client-side color buffer 則會在 application 啟動後才加入

#### `glxgears` 完成 Window／GLX setup，Mesa 產生 pixels

Xorg display storage 已準備完成。 Application startup 的另一條 setup 路徑還要建立哪些 GLX／Mesa objects，軟體 renderer 才能產生第一幀 pixels？

![GLX 生命週期 第 3 階段：application 建立 GLX context，軟體 renderer 產生 pixels](./image/glx-lifecycle-stage-3-application-rendering.png)

圖中的灰色 X11 Window objects 與 `XCreateWindow()` 箭頭表示一次性的 application／Window setup，橘色 objects 與箭頭才表示 application rendering

第 3 張生命週期圖聚焦 application setup 與 rendering。 `glxgears` 先建立 application Window 與 OpenGL context。 `XMapWindow()` 送出非同步 request，Xorg 後續會產生 `MapRequest`，再由 `twm` 建立 frame／title Windows，並將 application Window reparent 到 frame 下方

Application source 不會等待 Window Manager 完成這些工作，下一行就會呼叫 `glXMakeCurrent()`，將 context 與 application Window 對應的 drawable 設為目前執行緒的 rendering environment

Client 行程內會建立一份 Mesa client-side color buffer，軟體 renderer 使用 guest CPU 將這一幀算成 pixels。 這個生命週期階段新增的是 application 與 Mesa objects，以及位於 Mesa client-side color buffer 的 rendering 結果。 VM boot 與 `startx` 建立的 display objects 維持原狀

application rendering 結束時，pixels 仍停在 Mesa 一側。 它們還沒有套用 Window 的位置與 clipping，也沒有更新 host resource。 下一階段從 swap 開始，將前一輪看過的三個後續動作合併成一次 display update

#### Swap、Window update 與 Scanout update

application 呼叫 swap 後，pixel handoff、Window update 與 Scanout update 如何在同一個生命週期階段內接續，直到本例的 SDL window 顯示下一幀？

![GLX 生命週期 第 4 階段：client pixel handoff、Window update 與 scanout update](./image/glx-lifecycle-stage-4-client-present-display-update.png)

第 4 階段是 client pixel handoff 與 display update。 `glXSwapBuffers()` 讓 `drisw` 經 loader callback 回到 Mesa GLX，Mesa GLX 再呼叫 `XPutImage()` 或 `XShmPutImage()`。 libX11／libXext 建立 wire request 後，X server 在處理 request 時加入 Window origin 並套用 GC composite clip，直接更新 screen Pixmap／front BO

在本文固定的 front-buffer 組態中，Xorg modesetting 會在 dirty tracking 已啟用且 Damage Region 非空時，以 `drmModeDirtyFB()` 將改動的矩形交給 DRM／KMS。 virtio-gpu 將 `TRANSFER_TO_HOST_2D` 與 `RESOURCE_FLUSH` 排入 control virtqueue，semu 收到後再把可發布的 snapshot 排入 display queue。 SDL event loop 最後更新 texture，讓本例的 SDL window 顯示新一幀畫面

這個生命週期階段將一幀內的三個動作放進同一段時間，從 application swap 開始，到 host display 更新為止。 前三個階段各自建立的 device、screen 與 client objects 會在此一起工作

最後一張圖將前四張圖放在同一條生命週期中。 圖中的大區塊仍按 device、display setup、application rendering 與 display update 分類，實際事件依下列順序發生：

1. Linux 探測 virtio-gpu device 並建立 KMS topology。 `startx` 啟動 Xorg 後，modesetting 再開啟 DRM device 並讀取顯示資源
2. modesetting `ScreenInit()` 建立 front BO，本文選定的分支送出 `DRM_IOCTL_MODE_CREATE_DUMB`，並建立 `RESOURCE_CREATE_2D`／`RESOURCE_ATTACH_BACKING`
3. Xorg 建立 Root Window，再由 `CreateConnectionBlock()` 準備 connection setup reply
4. `NotifyParentProcess()` 送出 SIGUSR1，喚醒仍在等待 Xorg 的 `xinit`。 `waitforserver()` 接著仍會呼叫 `XOpenDisplay()`，等待 Xorg 完成 connection setup exchange
5. Xorg 進入 `Dispatch()`，第一次 `WaitForSomething()` 執行 one-shot BlockHandler
6. one-shot BlockHandler 依序以 `ADDFB` 建立 KMS framebuffer、執行 initial `SETCRTC`，並由 virtio-gpu 送出 initial `SET_SCANOUT`
7. Xorg 的 event loop 接受 `xinit` 用來測試 server 的 setup connection，並回傳 setup reply
8. `waitforserver()` 的 `XOpenDisplay()` 成功，`xinit` 接著呼叫 `startClient()`
9. system `xinitrc` 啟動 `twm`、`xclock` 與 `xterm`，這些 clients 分別連到 Xorg
10. `twm` 在 Root Window 選取 `SubstructureRedirectMask`，取得 Window Manager 角色
11. 使用者執行 `glxgears`，application 依序完成 `XOpenDisplay()`、`glXChooseVisual()`、`XCreateWindow()` 與 `glXCreateContext()`
12. `XMapWindow()` 非同步送出 MapWindow request。 Xorg 後續會產生 `MapRequest`，再由 `twm` 建立 frame／title Windows
13. Application source 不等待 `MapRequest` 處理完成，接著呼叫 `glXMakeCurrent()`，將 OpenGL context 與 application Window 對應的 drawable 設為目前執行緒的 rendering environment
14. softpipe 將 rendering 結果寫入 Mesa client-side color buffer
15. `glXSwapBuffers()` 觸發 pixel handoff 與 Window update，後續的 `DIRTYFB` 再把 screen damage 交給 scanout update

這個順序可以用來回答三個時間問題：

- 哪些工作屬於初始化？
- 哪些工作只在 Window management event 發生時執行？
- 哪些工作會在每一幀畫面再次發生？

![GLX 生命週期主資料路徑：device probe、Xorg display setup、session clients、application rendering 與 DIRTYFB update](./image/glx-lifecycle-stage-5-complete.png)

這張圖沿用相同配色：灰色是 application／Window setup，藍色是 device probe，綠色是 display setup，橘色是 rendering，紫色是 client pixel handoff／display update

第 5 張圖將四段主要資料路徑放進同一張圖。 Linux device probe、Xorg 的 `ScreenInit()`／connection setup／initial KMS、`xinitrc` 與 `twm` role 都屬於 application 啟動前的準備工作

Application startup 隨後分成兩條可以交錯的 setup 路徑。 `twm` 與 Xorg 處理 frame Window、reparent、geometry 與 clip，application 與 Mesa 則建立 GLX objects 與 Mesa client-side color buffer。 第一個可見 frame 需要兩條 setup 路徑都完成，後續每一幀才重複 rendering、swap 與 `DIRTYFB` display update

主資料路徑圖也讓四個 guest-side 工作區域回到同一條路徑：Application 發出操作，Mesa 產生 client-side pixels，X11／Xorg 決定可見 screen content，DRM／kernel 管理 scanout storage。 Host emulator 位於這四個區域之外，作為最後的 host display 邊界。 Pixels 依序跨過 guest owners 再抵達 host，object 的生命週期則可能長於一幀畫面

在本例固定的 softpipe 2D 組態下，rendering 留在軟體 renderer，virtio-gpu 的工作集中在 display pipeline。 Guest CPU 先完成 application 的 OpenGL work，virtio-gpu 之後才搬移並發布 front BO 的 dirty pixels。 這項分工把 Mesa 在本例中的入口與出口圈了出來

## Application 如何進入 Mesa

`glxgears` 此時已透過 `XOpenDisplay()` 完成 X11 connection setup，接下來的第一個 GLX 呼叫是 `glXChooseVisual()`。 這個呼叫會讓 application 第一次進入 GLX vendor path

本章先確認 GLX 呼叫會載入哪些執行期 artifacts，再以 `glXCreateContextAttribsARB()` 與 direct make-current 的原始程式碼路徑作為代表，依序追蹤 GLVND 如何找到 Mesa vendor、Mesa GLX 如何建立 client-side context、DRI 如何接上 State Tracker，以及成功與失敗時各層要保留或釋放哪些 object。 這條 Mesa 入口同時適用於前面的 drisw 基準路徑與後面的 VirGL 3D 路徑

### Mesa 建置後產生哪些執行期 artifact

在 `glXChooseVisual()` 開始執行以前，application 尚未進入任何 Mesa 函式。 呼叫開始後，libGLX／GLVND 會依 vendor mapping 載入 Mesa vendor 函式庫，再由 ELF dynamic loader 依 soname 解析該 shared object 與相依函式庫

同一份 Mesa 安裝目錄還可能有 Gallium DRI megadriver、`dril_dri` 與 driver-name symlinks。 要判斷下一節的 vendor 入口是否已連入 DRI 實作，必須同時讀 Meson 的輸出名稱與 `link_with`／`link_whole`

#### GLX vendor 函式庫

application 的 GLX 呼叫要由 GLVND 載入 Mesa vendor，因此建置結果必須同時提供可識別的函式庫名稱與 vendor ABI code。 `with_glvnd` 分支直接決定 installed soname 與納入 shared object 的 registration／dispatch glue。 以下從 `src/glx/meson.build` 的 `gl_lib_name` assignment 與 `shared_library()` 證明 artifact identity 和內容

以下程式碼來自 [`Mesa: src/glx/meson.build:89`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/meson.build#L85-98) 與 [`Mesa: src/glx/meson.build:127`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/meson.build#L127-139) 的 `gl_lib_name` 選擇與 `libglx_mesa` target。 建置定義顯示 `with_glvnd` 分支將輸出名改成 `GLX_mesa` 並加入 GLVND glue sources，`shared_library()` 再以 `link_whole` 收進 `libglx` 與 `libgl_link`：

```meson
if not with_glvnd
  gl_lib_name = 'GL'
  gl_lib_version = '1.2.0'
else
  gl_lib_name = 'GLX_@0@'.format(glvnd_vendor_name)
  gl_lib_version = '0.0.0'
  files_libglx += files(
    'g_glxglvnddispatchfuncs.c',
    'g_glxglvnddispatchindices.h',
    'glxglvnd.c',
    'glxglvnd.h',
    'glxglvnddispatchfuncs.h',
  )
endif
...
libgl = shared_library(
  gl_lib_name,
  [],
  link_whole : [libglx, libgl_link],
  link_args : [ld_args_bsymbolic, ld_args_gc_sections, extra_ld_args_libgl],
  dependencies : [
    dep_libdrm, dep_dl, dep_m, dep_thread, dep_x11, dep_xcb_glx, dep_xcb,
    dep_x11_xcb, dep_xext, dep_xxf86vm, dep_xcb_shm, extra_deps_libgl,
  ],
  version : gl_lib_version,
  darwin_versions : '4.0.0',
  install : true,
)
```

`link_whole : [libglx, libgl_link]` 表示輸出的 vendor shared object 納入 `libglx` 靜態函式庫的完整內容。 這個 artifact 同時包含 GLX client object、X11 request handling、direct-rendering glue 與 vendor ABI，內容超過單純把操作轉送給另一個行程的薄表

`libgl_link` 在 GLVND 分支是空陣列，因為公開 GL 入口的對外提供方式由 GLVND 架構處理，不需要把非 GLVND 分支使用的 bridge 同樣塞進 vendor 函式庫

因此 application 看到的最外層名稱與 Mesa 內部實作可以分成兩句。 `libGLX_mesa.so.0` 是 GLVND 對 Mesa GLX vendor 的執行期 identity。 `libglx` 則是建置期 static target，供前者 whole-link，不是讓 application 以該名稱自行載入的公開 artifact。 把建置 target 與 installed soname 分開，才不會在 backtrace 裡尋找根本不該出現的 `libglx.so`

#### Gallium DRI megadriver

Mesa GLX vendor 已有公開 GLX 入口，但 direct context 還需要 DRI frontend 與一個能建立 `pipe_screen` 的 driver 實作。 Gallium DRI target 的 link sets 會顯示這些 object 是否聚合在同一共享函式庫，也會說明 driver name 對應獨立 binary 或 megadriver alias。 以下從 `libgallium_name` 分支與 `libgallium_dri` target 找到答案

接著 `shared_library` 把同一份 DRI frontend 與建置中啟用的多個 Gallium driver 收進單一 artifact。 這種聚合是 megadriver 的核心含義，每一張 GPU 不需要各編一份完整 Mesa core

以下程式碼來自 [`Mesa: src/gallium/targets/dri/meson.build:37`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/targets/dri/meson.build#L36-57) 的 `libgallium_name` 與 `libgallium_dri` target。 target 宣告顯示名稱分支決定 versioned 或 unversioned artifact，`shared_library()` 的 `link_whole` 則把 DRI frontend 與選定的 Gallium driver archives 聚合進同一輸出：

```meson
if get_option('unversion-libgallium') or with_platform_android
  libgallium_name = 'gallium_dri'
else
  libgallium_name = 'gallium-@0@'.format(meson.project_version())
endif

libgallium_dri = shared_library(
  libgallium_name,
  files('dri_target.c'),
  include_directories : [
    inc_include, inc_src, inc_mesa, inc_gallium, inc_gallium_aux, inc_util, inc_gallium_drivers,
    inc_gallium_winsys, include_directories('../../frontends/dri'),
  ],
  gnu_symbol_visibility : 'hidden',
  link_args : [ld_args_build_id, ld_args_gc_sections, gallium_dri_ld_args],
  link_depends : gallium_dri_link_depends,
  link_with : [
    libmesa, libgalliumvl,
    libgallium, libglapi, libpipe_loader_static, libws_null, libwsw, libswdri,
    libswkmsdri, gallium_dri_link_with
  ],
  link_whole : [libdri, gallium_dri_link_whole],
...
```

這段的 `libgallium_dri` 是 Meson target variable。 它可以被另一個 target 直接 link，也可以依安裝規則成為執行期 shared object。 `libdri` 透過 `link_whole` 納入 frontend，`gallium_dri_link_whole` 納入選定 driver 的 whole archives

`libmesa`、`libgallium` 與 `libglapi` 等 target 提供 core 與共用基礎。 最終 artifact 內雖然聚合多個 driver，建立 screen 時仍只會依裝置與 loader information 選出合適的一個 pipe screen，不會因為 code 同處一個 shared object 就同時執行所有 backend

megadriver 的價值也在於 code sharing。 DRI-facing 入口與 Mesa core 只有一份，driver-specific 實作由 screen 建立流程選定。 安裝端可能另外建立傳統 `<driver>_dri.so` 名稱的 symlink，使既有 loader 能以 driver name 查找

symlink 的檔名是 selection key，實際 inode 可以共同指向同一個聚合 artifact。 因此「載入了某個 driver 名稱」不等於「磁碟上存在一份完全獨立的 driver binary」

對本章的 GLX direct 路徑而言，還有一個更重要的建置期條件。 `libgallium_dri` 不一定要等到 application 第一次建立 context 才由名稱查找。 下一小節所示的 `src/glx/meson.build` 會在 `with_dri` 時把這個 Meson target 加到 `libglx` 的 link 集合

在這個固定 commit 與設定分支下，GLX vendor artifact 可以已經帶有 Gallium DRI 實作。 通用 DRI loader 的 `dlopen` 規則仍然存在，但不能不看呼叫端就把它套在每條 GLX 呼叫路徑上

#### 執行期函式庫、DRI driver 與 loader 的關係

artifact 都已辨認後，還要判斷這個 GLX 建置是在 link time 納入 Gallium DRI，還是由某個呼叫端在執行期以 driver name 搜尋 `_dri.so`。 這會改變 `dlopen` 是否出現在實際呼叫鏈，也會改變載入失敗的清理 owner。 以下先讀 `glx_gallium_link`，再讀 `dril_dri` aliases 與 `loader_open_driver_lib()` 的執行期分支

以下程式碼來自 [`Mesa: src/glx/meson.build:100`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/meson.build#L100-121) 的 `glx_gallium_link` 與 `libglx` declarations，用來判斷 GLX vendor artifact 是否在建置期納入 Gallium DRI。 `with_dri` 成立時，Meson 將 `libgallium_dri` 加入 `link_with`。 `libglx` 本身則以 static target 收攏 GLX sources，供 vendor shared object 在建置期組合：

```meson
glx_gallium_link = []
if with_dri
  glx_gallium_link += libgallium_dri
endif
if with_platform_windows
  glx_gallium_link += libgallium_wgl
endif
libglx = static_library(
  'glx',
  [files_libglx, glx_generated, main_dispatch_h],
  include_directories : [inc_include, inc_src, inc_glapi, inc_loader, inc_loader_x11,
                         inc_gallium, inc_mesa, inc_st_dri, inc_gallium_aux],
  gnu_symbol_visibility : 'hidden',
  link_with : [
    libloader, libloader_x11,
    extra_libs_libglx, glx_gallium_link
  ],
  dependencies : [
    idep_mesautil, idep_xmlconfig,
    dep_libdrm, dep_glproto, dep_x11, dep_xext, dep_glvnd, dep_xxf86vm, dep_xshmfence,
  ],
)
```

這裡的 `link_with` 是建置期組合。 application 行程載入 Mesa GLX vendor artifact 後，該 artifact 內的 direct-rendering 路徑可以直接呼叫已連入的 DRI frontend symbol。 它與 loader 依 driver name 搜尋檔案的執行期組合是兩種機制。 兩者都可能出現在 Mesa，但必須以特定呼叫端與建置組態判定，不能畫成固定多一層 shared-object hop

`dril_dri` 是另一種用途的 artifact。 它的 target 只 link `libgallium`，建置註解也明示 Meson 建立的原始檔會在 install 流程處理

以下程式碼來自 [Mesa: src/gallium/targets/dril/meson.build:42](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/targets/dril/meson.build#L42-63) 的 `dril_dri` shared target。 定義顯示 sources、hidden symbol visibility、link arguments，以及透過 `link_with` 連入 `libgallium`。 這個 legacy-facing loader artifact 會安裝到 DRI drivers directory：

```meson
dril_dri = shared_library(
  'dril_dri',
  files('dril_target.c'),
  include_directories : [
    inc_include, inc_src, inc_mesa, inc_gallium, inc_gallium_aux, inc_util, inc_gallium_drivers,
    inc_gallium_winsys,
  ],
  gnu_symbol_visibility : 'hidden',
  link_args : [ld_args_build_id, ld_args_gc_sections, dril_ld_args],
  link_depends : dril_link_depends,
  link_with : [
    libgallium,
  ],
  dependencies : [
    idep_mesautil,
    dep_gbm,
  ],
  # Will be deleted during installation, see install_megadrivers.py
  install : true,
  install_dir : dri_drivers_path,
  name_suffix : libname_suffix,
)
```

`dril_dri` 負責 Xorg 所需的 legacy DRI-facing 初始化與 framebuffer configuration，application direct context 的 rendering 實作由 Gallium DRI megadriver 提供。 Alias 名稱只選定 loader 進入點，實際 backend 仍由 megadriver 內的 driver descriptor 與 screen factory 決定

以下程式碼來自 [Mesa: src/gallium/targets/dril/meson.build:120](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/targets/dril/meson.build#L120-145) 的 `dri_drivers` table 與 alias loop。 這兩段可用來確認 VirGL、Freedreno virtio 或 AMDGPU virtio 任一 predicate 成立時，`virtio_gpu` 會進入 name list，迴圈再依 `libname_suffix` 產生對應的 `_dri` symlink 名稱：

```meson
...
             [with_gallium_virgl or
               (with_gallium_freedreno and freedreno_kmds.contains('virtio')) or
               (with_gallium_radeonsi and with_amdgpu_virtio),
               ['virtio_gpu']],
...
  if d[0]
    foreach name : d[1]
      dril_drivers += '@0@_dri.@1@'.format(name, libname_suffix)
    endforeach
  endif
endforeach

# This only works on Unix-like oses, which is probably fine for dri
if prog_ln.found()
  foreach d : dril_drivers
    custom_target(
      d,
      output : d,
      command : [prog_ln, '-sf', dril_dri.full_path(), '@OUTPUT@'],
      build_by_default : true,
    )
  endforeach
endif
```

以下程式碼來自 [Mesa: src/gallium/targets/dril/meson.build:147](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/targets/dril/meson.build#L147-154) 的 megadriver install block。 安裝呼叫顯示 `dril_drivers.length()` 控制是否執行 installer，傳入值則依序是 `dril_dri.full_path()`、安裝目錄、完整 alias list 與 `runtime` tag：

```meson
if dril_drivers.length() > 0
  meson.add_install_script(
    install_megadrivers,
    dril_dri.full_path(),
    dri_drivers_path,
    dril_drivers,
    install_tag : 'runtime',
  )
...
```

以下程式碼來自 [Mesa: src/loader/loader.c:866](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/loader/loader.c#L865-884) 的 `loader_open_driver_lib()`。 搜尋分支顯示函式先依 `search_path_vars` 選環境設定或 `default_search_path`，再逐一組合 `driver_name`、`lib_suffix` 與 directory，直到 `dlopen()` 成功或所有候選路徑耗盡：

```c
void *
loader_open_driver_lib(const char *driver_name,
                       const char *lib_suffix,
                       const char **search_path_vars,
                       const char *default_search_path,
                       bool warn_on_fail)
{
   char path[PATH_MAX];
   const char *search_paths, *next, *end;

   search_paths = NULL;
   if (__normal_user() && search_path_vars) {
      for (int i = 0; search_path_vars[i] != NULL; i++) {
         search_paths = os_get_option(search_path_vars[i]);
         if (search_paths)
            break;
      }
   }
   if (search_paths == NULL)
      search_paths = default_search_path;
...
}
```

以下程式碼來自 [Mesa: src/loader/loader.c:886](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/loader/loader.c#L886-905) 的 `loader_open_driver_lib()`，用來確認 loader 如何逐一組出 DRI 共享函式庫路徑、以 `dlopen()` 載入，並在第一個成功結果停止搜尋：

```c
void *
loader_open_driver_lib(const char *driver_name,
                       const char *lib_suffix,
                       const char **search_path_vars,
                       const char *default_search_path,
                       bool warn_on_fail)
{
...
   void *driver = NULL;
   const char *dl_error = NULL;
   end = search_paths + strlen(search_paths);
   for (const char *p = search_paths; p < end; p = next + 1) {
      int len;
      next = strchr(p, ':');
      if (next == NULL)
         next = end;

      len = next - p;
      snprintf(path, sizeof(path), "%.*s/%s%s.so", len,
               p, driver_name, lib_suffix);
      driver = dlopen(path, RTLD_NOW | RTLD_LOCAL);
      if (driver == NULL) {
         dl_error = dlerror();
         log_(_LOADER_DEBUG, "MESA-LOADER: failed to open %s: %s\n",
              path, dl_error);
      }
      /* not need continue to loop all paths once the driver is found */
      if (driver != NULL)
...
   }
...
}
```

三類 artifact 至此可以用 owner 與用途分開。 GLX vendor 函式庫接受 GLVND vendor ABI，並擁有 application-side GLX object。 Gallium DRI megadriver 聚合 direct-rendering frontend 與 rendering backend，且在此建置圖中可由 GLX target link。 `dril_dri` 則保留 Xorg legacy 初始化所需的相容介面與 alias

通用 loader 只在呼叫端選擇執行期 name lookup 時介入。 三類 artifact 之間不存在永遠固定的執行期轉接次序

三類 artifact 的建置關係與責任分工如下：

- installed GLX vendor artifact whole-link `libglx`，而 `with_dri` 分支又把 Gallium DRI target 加入 `libglx`
- 選擇執行期 name lookup 的呼叫端才會把 `<driver_name>_dri.so` 當成 loader key，逐一嘗試搜尋路徑
- `dril_dri` 與安裝 aliases 提供 Xorg legacy DRI-facing 初始化，並不形成每個 application GLX 呼叫都必經的執行期 hop

下一節的 `__glx_Main()` 詳細 callgraph 從實際執行期入口開始。 Meson target 關係到此完成 artifact handoff，執行期控制流程則由 loader 進入 vendor ABI

### GLVND 選到 Mesa vendor

執行期 artifact 已可載入，application 現在呼叫 `glXCreateContextAttribsARB()`，但新 context 尚未存在，GLVND 還不能用 context mapping 選 vendor。 要讓這次呼叫進入 Mesa，函式庫必須先完成 ABI handshake，再由 FBConfig 或 screen drawable 找到 vendor，最後為新 `GLXContext` 建立 mapping。 這三步的失敗點會決定公開呼叫是否能回傳有效 handle

這套 mapping 與 Mesa 內部 GL dispatch 是兩個層次。 GLX vendor mapping 決定某次 GLX 操作進哪個 vendor 函式庫。 Mesa GL dispatch table 則在 vendor 已確定、context 已 make-current 後，決定 `glDrawArrays` 的公開 stub 要跳到哪個 context 實作。 兩張 table 都叫 dispatch，key、owner 與更新時機卻不同

#### Vendor ABI registration

GLVND 剛載入 Mesa vendor 函式庫，手上有 ABI version、GLVND exports、vendor identity 與待填的 imports table。 Registration 先驗證版本，再固定 Mesa 與 GLVND 之間的 callback 方向，後續 screen selection 與 dynamic dispatch 才取得可用的 ABI table。 以下從公開入口 `__glx_Main()` 的 version predicate、global assignment 與 callback registration 判斷成功條件

以下程式碼來自 [`Mesa: src/glx/glxglvnd.c:57`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxglvnd.c#L57-82) 的 `__glx_Main()`，用來證明 major 不符或 minor 太舊會回傳 `False`，而第一次成功初始化會保存 `exports` 並填入四個 Mesa callback

```c
_X_EXPORT Bool __glx_Main(uint32_t version, const __GLXapiExports *exports,
                          __GLXvendorInfo *vendor, __GLXapiImports *imports)
{
    static Bool initDone = False;

    if (GLX_VENDOR_ABI_GET_MAJOR_VERSION(version) !=
        GLX_VENDOR_ABI_MAJOR_VERSION ||
        GLX_VENDOR_ABI_GET_MINOR_VERSION(version) <
        GLX_VENDOR_ABI_MINOR_VERSION)
        return False;

    if (!initDone) {
        initDone = True;
        __glXGLVNDAPIExports = exports;

        imports->isScreenSupported = __glXGLVNDIsScreenSupported;
        imports->getProcAddress = __glXGLVNDGetProcAddress;
        imports->getDispatchAddress = __glXGLVNDGetDispatchAddress;
        imports->setDispatchIndex = __glXGLVNDSetDispatchIndex;
        imports->notifyError = NULL;
        imports->isPatchSupported = NULL;
        imports->initiatePatch = NULL;
    }

    return True;
}
```

`exports` 的方向是 GLVND 提供給 vendor。 Mesa 把 pointer 存進行程全域 `__glXGLVNDAPIExports`，後續可呼叫 `getDynDispatch`、`fetchDispatchEntry` 及各種 object mapping operation。 `imports` 的方向相反，由 Mesa 填入可供 GLVND callback 的 vendor operations。 兩張 table 交換的是函式指標與 ABI contract，不是 GLX context 本體

`initDone` 使 callback table assignment 只做一次。 它沒有把 display 或 screen cache 建在 registration 函式裡。 `isScreenSupported` 讓 GLVND 詢問 vendor 是否支援指定 screen

`getProcAddress` 取得一般 GL 或 GLX 函式指標。 `getDispatchAddress` 則回傳 Mesa 為動態 GLX dispatch 產生的 wrapper 函式指標，`setDispatchIndex` 將 GLVND 分配的 slot index 寫入 Mesa generated index 陣列

最後兩個 callback 要成對理解。 GLVND 可先向 vendor 詢問某個 GLX 名稱應使用哪個 dispatch wrapper，再告知該名稱在 GLVND table 裡的 index。 wrapper 執行時利用這個 index 呼叫 `fetchDispatchEntry`，取得當下 vendor 函式。 名稱查找發生在 setup，而不是讓每一次 extension GLX 呼叫都重新掃描 symbol table

```callgraph
GLVND / Mesa vendor ABI registration
=================================================
GLVND 載入 Mesa vendor 函式庫
  ↓
[Mesa: src/glx/glxglvnd.c:57] __glx_Main(version, exports, vendor, imports)
  │
  ├─ if (ABI major != required major || minor < required minor)
  │    └─ return False                    // import table 保持未註冊
  │
  └─ ABI compatible
       ├─ initDone == false
       │    ├─ initDone = True
       │    ├─ __glXGLVNDAPIExports = exports
       │    └─ imports->{isScreenSupported,getProcAddress,
       │                 getDispatchAddress,setDispatchIndex} = Mesa callbacks
       └─ return True
            // handoff：雙方保存的 versioned callback tables
            ↓
[Mesa: src/glx/glxglvnd.c:40] __glXGLVNDGetDispatchAddress(procName)
  │
  │  internalIndex = FindGLXFunction(procName);
  └─ return __glXDispatchFunctions[internalIndex]
       ↓
[Mesa: src/glx/glxglvnd.c:47] __glXGLVNDSetDispatchIndex(procName, index)
  │
  ├─ unknown/static dispatch：return
  └─ __glXDispatchTableIndices[internalIndex] = index
       // 最終結果：GLVND slot 與 Mesa generated wrapper 建立穩定對應
```

這裡還沒有 Mesa rendering context，也沒有目前執行緒的 draw framebuffer。 registration 的成功只表示兩個函式庫對 ABI table 的版本與 callback 方向達成一致。 GPU、FBConfig 與 sharing 等 context 條件要等真正的 GLX 建立呼叫才能處理

#### CreateContext 的 vendor mapping

ABI registration 已成功，application 接著交入 `Display *`、`GLXFBConfig`、可選的 sharing context 與 attributes，但新 `GLXContext` 還沒有 mapping。 Vendor 必須先由既有的 FBConfig 或 screen identity 選出

空 config、錯誤 screen 與 mapping 失敗各自在這段選擇流程決定回傳與清理。 以下讀 generated `dispatch_CreateContextAttribsARB()` 的兩個 selection 分支與 `AddContextMapping()` 結果

以下程式碼來自 [Mesa: src/glx/g_glxglvnddispatchfuncs.c:159](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/g_glxglvnddispatchfuncs.c#L159-184) 的 `dispatch_CreateContextAttribsARB()`。 前半段可觀察 `config` 非空時走 `GetDispatchFromFBConfig()`。 只有 attributes 提供 `GLX_SCREEN` 時才以 Root Window 查 drawable mapping，之後取得 vendor create 入口並要求 `AddContextMapping()` 接受新 handle：

```c
static GLXContext dispatch_CreateContextAttribsARB(Display *dpy,
                                                   GLXFBConfig config,
                                                   GLXContext share_list,
                                                   Bool direct,
                                                   const int *attrib_list)
{
    PFNGLXCREATECONTEXTATTRIBSARBPROC pCreateContextAttribsARB;
    __GLXvendorInfo *dd = NULL;
    GLXContext ret;

    if (config) {
       dd = GetDispatchFromFBConfig(dpy, config);
    } else if (attrib_list) {
       int i, screen;

       for (i = 0; attrib_list[i * 2] != None; i++) {
          if (attrib_list[i * 2] == GLX_SCREEN) {
             screen = attrib_list[i * 2 + 1];
             dd = GetDispatchFromDrawable(dpy, RootWindow(dpy, screen));
             break;
          }
       }
    }
    if (dd == NULL)
        return None;
...
}
```

`GLXFBConfig` mapping 必須更早由取得 FBConfig 的 GLX 路徑建立。 這也是 FBConfig 不能只當成一組 format 數值的原因。 對 GLVND 而言，它同時是 vendor-selection identity。 Root Window fallback 則把 X Screen 的編號轉成已有 drawable namespace 可判定的 XID，再由 GLVND export 找到 dynamic dispatch。 兩者均未查看 Mesa `gl_context`，因為此時那個 object 尚不存在

取得 `dd` 後，`__FETCH_FUNCTION_PTR(CreateContextAttribsARB)` 使用 registration 階段設好的 dispatch index，請 GLVND 交回該 vendor 的真正函式指標。 Mesa wrapper 呼叫它建立 context，接著用回傳的 `GLXContext` 登記新的 context-to-vendor mapping

以下程式碼來自 [Mesa: src/glx/g_glxglvnddispatchfuncs.c:185](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/g_glxglvnddispatchfuncs.c#L185-198) 的 `dispatch_CreateContextAttribsARB()`，用來確認 callback 缺失與 `AddContextMapping()` 失敗都會回傳 `None`，只有 mapping 成功才公開新的 `GLXContext`：

```c
static GLXContext
dispatch_CreateContextAttribsARB(Display *dpy,
                                 GLXFBConfig config,
                                 GLXContext share_list,
                                 Bool direct,
                                 const int *attrib_list)
{
...
    __FETCH_FUNCTION_PTR(CreateContextAttribsARB);
    if (pCreateContextAttribsARB == NULL)
        return None;

    ret = pCreateContextAttribsARB(dpy, config, share_list, direct, attrib_list);
    if (AddContextMapping(dpy, ret, dd)) {
        /* XXX: Call glXDestroyContext which lives in libglvnd. If we're not
         * allowed to call it from here, should we extend __glXDispatchTableIndices ?
         */
        return None;
    }

    return ret;
}
```

mapping 的 value 是先前選出的 `dd`，key 則是 vendor create 呼叫回傳的公開 `GLXContext`。 `AddContextMapping` 成功後，`glXMakeCurrent`、`glXDestroyContext` 以及只攜帶 context handle 的 GLX 呼叫才能回到相同 vendor。 這個登記不會把公開 handle 改成 DRI pointer，也不會延長 Mesa context wrapper 自己定義的生命週期

source 對 mapping 失敗的行為很具體：wrapper 回傳 `None`，因此公開呼叫不會把缺少 mapping 的 `ret` 交回 application。 旁邊註解同時保留一項未決問題，即已建立 context 要如何跨 GLVND 邊界完成 destroy。 這個分支沒有可由目前 source 證明的完整清理

```callgraph
Mesa GLVND generated context dispatch
=================================================
[Mesa: src/glx/g_glxglvnddispatchfuncs.c:159] dispatch_CreateContextAttribsARB(...)
dispatch_CreateContextAttribsARB(dpy, config, share_list, direct, attrib_list)
  │
  ├─ if (config != NULL)
  │    └─ dd = GetDispatchFromFBConfig(dpy, config)
  │         ↓
  │       [Mesa: src/glx/glxglvnddispatchfuncs.h:59] GetDispatchFromFBConfig()
  │         └─ __VND->vendorFromFBConfig(dpy, config)
  │
  └─ config == NULL && attrib_list contains GLX_SCREEN
       └─ dd = GetDispatchFromDrawable(dpy, RootWindow(dpy, screen))
            ↓
          [Mesa: src/glx/glxglvnddispatchfuncs.h:48] GetDispatchFromDrawable()
            └─ __VND->vendorFromDrawable(dpy, drawable)
  │
  ├─ dd == NULL：return None
  └─ __FETCH_FUNCTION_PTR(CreateContextAttribsARB)
       ├─ 函式指標 == NULL：return None
       └─ ret = pCreateContextAttribsARB(...)
            // handoff：Display、FBConfig、sharing handle、direct flag、attributes
            ↓
       [Mesa: src/glx/glxglvnddispatchfuncs.h:42] AddContextMapping(dpy, ret, dd)
            ├─ mapping 失敗：return None
            └─ mapping 成功：return ret
                 // 最終結果：公開 GLXContext 可由後續 GLX 呼叫找回同一 vendor
```

這條順序也解釋 `share_list` 為何沒有負責初始 vendor selection。 generated wrapper 原樣把它交給 vendor create 函式，真正的 share compatibility 由後續 Mesa GLX 建立路徑驗證。 GLVND 這一層的首要責任是從 config 或 screen 找到 vendor，並讓新 handle 延續相同 vendor identity

#### OpenGL 函式指標與 dispatch slot

vendor mapping 已讓 GLX context 建立回到 Mesa，application 接著會保存 `glDrawArrays` 的函式指標。 這個函式指標必須在 context 切換後保持穩定，同時又要在呼叫時導向目前執行緒的實作

若要分清公開 stub、dispatch slot 與 driver callback，必須讀 name lookup 與 TLS table assignment。 以下從 `glXGetProcAddressARB()`、`_mesa_glapi_get_proc_address()` 與 `_mesa_glapi_set_dispatch()` 拆開兩個階段

以下程式碼來自 [Mesa: src/glx/glxcmds.c:2375](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcmds.c#L2375-2387) 的 `glXGetProcAddressARB()`，用來確認 `glX` 名稱先查 GLX 入口，其餘或查找失敗者再交給 shared GLAPI stub lookup：

```c
_GLX_PUBLIC void (*glXGetProcAddressARB(const GLubyte * procName)) (void)
{
   typedef void (*gl_function) (void);
   gl_function f = NULL;

   if (!strncmp((const char *) procName, "glX", 3))
      f = (gl_function) get_glx_proc_address((const char *) procName);

   if (f == NULL)
      f = (gl_function) _mesa_glapi_get_proc_address((const char *) procName);

   return f;
}
```

Mesa GLAPI 的 name metadata 把每個公開 GL 函式對應到 `mapi_stub.slot`。 `_mesa_glapi_get_proc_address` 找到 stub 後，以該 slot 取得公開入口。 這個結果是可呼叫的公開函式指標。 它不是從 current context table 取出的 driver 函式指標，因此 context 切換後 application 保存的函式指標仍可繼續使用

下一個片段同時呈現位址查找與 dispatch install。 前者將 `funcName` 轉成 `mapi_stub.slot`，後者將指定 table 或 no-op table 寫進執行緒區域 dispatch pointer

以下片段依序來自 [`Mesa: core.c:201`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/glapi/shared-glapi/core.c#L195-205) 的 `_mesa_glapi_get_proc_address()` 與 [`Mesa: core.c:261`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/glapi/shared-glapi/core.c#L255-268) 的 `_mesa_glapi_set_dispatch()`，用來追蹤公開入口查找與 current dispatch table 安裝：

```c
/**
 * Return pointer to the named function.  If the function name isn't found
 * in the name of static functions, try generating a new API entrypoint on
 * the fly with assembly language.
 */
_glapi_proc
_mesa_glapi_get_proc_address(const char *funcName)
{
   const struct mapi_stub *stub = _glapi_get_stub(funcName);
   return stub ? entry_get_public(stub->slot) : NULL;
}
...
/**
 * Set the global or per-thread dispatch table pointer.
 * If the dispatch parameter is NULL we'll plug in the no-op dispatch
 * table (__glapi_noop_table).
 */
void
_mesa_glapi_set_dispatch(struct _glapi_table *tbl)
{
   static once_flag flag = ONCE_FLAG_INIT;
   call_once(&flag, entry_patch_public);

   _mesa_glapi_tls_Dispatch =
      tbl ? tbl : (struct _glapi_table *)table_noop_array;
}
```

`entry_patch_public` 只以 `call_once` 執行一次，table pointer 則寫入 `_mesa_glapi_tls_Dispatch`。 傳入 NULL pointer 時會安裝 no-op table，避免公開 stub 直接解參照 NULL table。 真正 OpenGL context make-current 時，後續章節會看到 Mesa 同時設定 current context pointer 與該 context 的 dispatch table

一次 GL 呼叫因而可以拆成穩定入口與可變 target。 函式指標查找決定公開 stub 位址與 slot。 make-current 決定目前執行緒的 table pointer。 公開 stub 在呼叫時使用同一個 slot 從該 table 取實作。 vendor selection 已在更外層完成，不需要 `glDrawArrays` 每次再以 `Display` 或 FBConfig 查 Mesa vendor

```callgraph
Mesa GLX 函式指標查找
=================================================
[Mesa: src/glx/glxcmds.c:2375] glXGetProcAddressARB(procName)
  │
  ├─ 若 name 以 "glX" 開頭：get_glx_proc_address(procName)
  └─ f == NULL：_mesa_glapi_get_proc_address(procName)
       ↓
[Mesa: src/mesa/glapi/shared-glapi/core.c:201] _mesa_glapi_get_proc_address()
  │
  ├─ _glapi_get_stub(funcName) == NULL：return NULL
  └─ return entry_get_public(stub->slot)
       // terminal object 1：穩定的公開 stub 位址 + 固定 slot

Mesa GLAPI 在目前執行緒上的 target
=================================================
[Mesa: src/mesa/main/context.c:879] _mesa_set_dispatch(ctx, t)
  │
  ├─ ctx->GLThread.enabled && 目前是 glthread worker
  │    └─ _mesa_glapi_set_dispatch(t); return
  │         // worker 已由呼叫端執行緒 wrapper 記錄呼叫，直接安裝真實 table
  └─ 一般的 application 執行緒
       ├─ ctx->Dispatch.RealPublished = t
       └─ published = ctx->Dispatch.Trace ? ctx->Dispatch.Trace : t
            ↓
[Mesa: src/mesa/glapi/shared-glapi/core.c:261] _mesa_glapi_set_dispatch(published)
  │
  │  call_once(&flag, entry_patch_public)
  ├─ published != NULL：_mesa_glapi_tls_Dispatch = published
  └─ published == NULL：_mesa_glapi_tls_Dispatch = table_noop_array
       // 最終結果：公開 stub 在呼叫時由 TLS slot 找到 real、trace 或 no-op 實作
```

兩套 dispatch 有各自的 index domain。 GLVND 的 GLX dynamic dispatch index 服務 vendor ABI wrapper，object mapping 決定 vendor。 Mesa GLAPI slot 服務公開 GL 入口，執行緒區域 table 決定 current context 實作。 Debugger 中看到的 index 必須搭配建立它的 table 解讀

### GLX display、screen、FBConfig、context 與 drawable

vendor 已選到 Mesa，公開 create 呼叫現在要把 `Display *`、screen、FBConfig 與 optional sharing context 轉成 client-side GLX wrapper，再建立 DRI、State Tracker 與 Gallium contexts。 Wrapper 欄位記錄各層的 identity，direct 建立分支則記錄 object 成立的先後順序。 X server request 失敗時，清理會依這個順序反向拆除 local renderer objects

先從擁有這些 per-screen wrappers 的 object 開始。 Mesa 會為使用 GLX 的 libX11 `Display` 建立一個 `struct glx_display`。 `dpy` 回指 application 原本持有的 libX11 `Display`，`screens` 則是 Mesa GLX 自己的 pointer array

以下程式碼來自 [`Mesa: src/glx/glxclient.h:586`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L586-L633)，只列出這段關係需要的欄位：

```c
// [Mesa: src/glx/glxclient.h:586-633]
struct glx_display
{
   struct glx_display *next;
   enum glx_driver driver;
   ...
   Display *dpy;
   ...
   struct glx_screen **screens;
   ...
};
```

Mesa 接著以 libX11 `ScreenCount(dpy)` 取得這個 `Display` 的 X Screen 數量，配置 `glx_screen *` array，再逐一為每個 X Screen 選擇可用的 GLX backend。 以下程式碼來自 [`Mesa: src/glx/glxext.c:850`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxext.c#L850-L923) 的 `AllocAndFetchScreenConfigs()`，用來確認 libX11 與 Mesa GLX 兩側的 array 如何沿用相同的索引：

```c
// [Mesa: src/glx/glxext.c:850-923]
static Bool
AllocAndFetchScreenConfigs(Display *dpy, struct glx_display *priv,
                           enum glx_driver glx_driver,
                           Bool driver_name_is_inferred)
{
   struct glx_screen *psc;
   GLint i, screens;
   ...

   screens = ScreenCount(dpy);
   priv->screens = calloc(screens, sizeof *priv->screens);
   if (!priv->screens)
      return GL_FALSE;

   for (i = 0; i < screens; i++) {
      psc = NULL;
      ...
      if (glx_driver & GLX_DRIVER_DRI3) {
         bool use_zink;
         psc = dri3_create_screen(i, priv, driver_name_is_inferred,
                                  &use_zink);
         ...
      }
      ...
      if (psc == NULL && (glx_driver & GLX_DRIVER_SW || zink)) {
         psc = driswCreateScreen(i, priv, glx_driver,
                                 driver_name_is_inferred);
      }
      ...
      priv->screens[i] = psc;
      ...
   }
   ...
   return GL_TRUE;
}
```

`ScreenCount(dpy)` 讀取前面由 `XOpenDisplay()` 填入的 `Display::nscreens`。 迴圈使用同一個 `i` 嘗試建立 X Screen `i` 的 Mesa `glx_screen`，再將結果寫入 `priv->screens[i]`。 Backend 初始化成功時，該 element 指向新建立的 `glx_screen`； 初始化失敗時則保存 `NULL`

因此 libX11 `Display::screens[i]` 與 Mesa `glx_display::screens[i]` 都以 `i` 作為 X Screen 的陣列索引。 前者保存 X11 Screen 資料，後者在初始化成功後保存 GLX configuration 與 backend state

#### Direct DRI3 screen 如何取得 rendering fd

Mesa 為既有 libX11 `Display` 初始化 direct GLX screen 時，呼叫端只有代表 X11 connection 的 client-side object 與目標 X Screen 的編號。 在後續建立 DRI screen 與 renderer context 以前，Mesa 必須先透過這條 connection 取得該 X Screen 使用的 rendering fd

這個 fd 會成為後續選擇 driver、建立 DRI screen 與配置 rendering resource 的入口。 以下從 `dri3_create_screen()` 的 Root Window lookup 與提前回傳追蹤 fd 如何取得、由哪個 screen wrapper 保存，以及取得失敗時 Mesa 需要回收哪些 client-side object

以下程式碼來自 [`Mesa: src/glx/dri3_glx.c:461`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri3_glx.c#L459-481) 的 `dri3_create_screen()`，用來證明 Mesa 以既有 X11 connection、screen 的 Root Window 與新配置的 `dri3_screen` 取得 rendering fd，並在 open 失敗時只回收 client-side wrapper

```c
struct glx_screen *
dri3_create_screen(int screen, struct glx_display * priv, bool driver_name_is_inferred, bool *return_zink)
{
   xcb_connection_t *c = XGetXCBConnection(priv->dpy);
   const struct dri_config **driver_configs;
   struct dri3_screen *psc;
   __GLXDRIscreen *psp;
   char *driverName, *driverNameDisplayGPU;
   *return_zink = false;

   psc = calloc(1, sizeof *psc);
   if (psc == NULL)
      return NULL;

   psc->fd_display_gpu = -1;

   psc->fd_render_gpu = x11_dri3_open(c, RootWindow(priv->dpy, screen), None);
   if (psc->fd_render_gpu < 0) {
      int conn_error = xcb_connection_has_error(c);

      glx_screen_cleanup(&psc->base);
      free(psc);
...
   }
...
}
```

函式的輸入已經把責任邊界說得很清楚。 `priv->dpy` 指向代表既有 X11 connection 的 libX11 `Display`，`screen` 保存目標 X Screen 在這個 `Display` 內的編號。 `RootWindow(priv->dpy, screen)` 則提供一個屬於該 Screen 的 X resource identity

connector、CRTC、初始 scanout 與桌面 front storage 已在 Xorg display setup 階段成立。 `dri3_create_screen()` 從這份既有 display state 取得 Mesa rendering 所需的 identity

`x11_dri3_open()` 透過 X11 端的協作取得 rendering 所需的 fd。 回到 Mesa 後，`fd_render_gpu` 會成為 loader 選 driver、建立 DRI screen 與配置 renderer resource 的入口。 `fd_display_gpu` 保存 display device，因此資料模型可以表達 render device 與 display device 分屬不同 GPU。 在單 GPU 機器上，兩個欄位通常指向同一裝置

失敗路徑也值得先看。 若無法取得 `fd_render_gpu`，Mesa 清理已初始化的 `glx_screen` base 並釋放 `dri3_screen`。 Xorg 的 display state 繼續由 X server 擁有。 X connection 是否已發生錯誤是另一項診斷資訊。 這項清理範圍顯示 Mesa GLX client 回收的是自己在 client 行程內配置的 wrapper

因此，application 啟動時可以先採用下列責任圖。 圖中的「已存在」限定在 GLX context 建立當下，resize、hotplug 或桌面政策仍可在後續更新這些 object

```callgraph
Mesa GLX screen 初始化
=================================================
[Mesa: src/glx/glxext.c:850] AllocAndFetchScreenConfigs()
  │
  │  for (i = 0; i < ScreenCount(dpy); i++)
  │  if (glx_driver & GLX_DRIVER_DRI3)
  │      psc = dri3_create_screen(i, priv, ...);
  │  // 以既有 Display 的每個 X Screen 建立 client-side screen wrapper
  ↓
[Mesa: src/glx/dri3_glx.c:461] dri3_create_screen()
  │
  ├─ psc = calloc(1, sizeof *psc)
  │    └─ 配置失敗：return NULL
  │
  └─ psc->fd_render_gpu = x11_dri3_open(
         XGetXCBConnection(priv->dpy),
         RootWindow(priv->dpy, screen), None);
       // handoff：XCB connection + Root Window XID
       ↓
[Mesa: src/x11/x11_dri3.c:40] x11_dri3_open()
  │
  ├─ DRI3 extension absent：return -1
  ├─ reply == NULL || reply->nfd != 1：free(reply); return -1
  └─ fd = xcb_dri3_open_reply_fds(conn, reply)[0]
       │  fcntl(fd, F_SETFD, ... | FD_CLOEXEC)
       │  // 先取得 rendering fd，再向 X server 回報 client 支援的 XFixes 版本
       ├─ fixes_reply->major_version < 2
       │    └─ close(fd); fd = -1
       └─ fixes_reply->major_version >= 2
            └─ return fd
                 // 最終結果：FD_CLOEXEC rendering fd，或 XFixes 版本不足時的 -1
       ↓
[Mesa: src/glx/dri3_glx.c:477] dri3_create_screen() 失敗／成功分流
  │
  ├─ fd_render_gpu < 0
  │    └─ glx_screen_cleanup(&psc->base); free(psc); return NULL
  └─ fd_render_gpu >= 0
       └─ screen 初始化成功後，繼續使用 psc 與 rendering fd
```

成功取得 rendering fd 後，client wrapper 仍要保存 backend callbacks、X11 connection 與目標 X Screen 的編號。 以下程式碼來自 [`Mesa: src/glx/glxclient.h:516`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L516-540) 的 `struct glx_screen`，用來確認三組 vtable、`Display *` 與 `scr` 都位於同一份 screen wrapper

```c
struct glx_screen
{
   const struct glx_screen_vtable *vtable;
   const struct glx_context_vtable *context_vtable;
   const struct glx_drawable_vtable *drawable_vtable;
...
   const char *serverGLXexts;
   const char *serverGLXvendor;
   const char *serverGLXversion;
...
   char *effectiveGLXexts;

   struct glx_display *display;

   Display *dpy;
   int scr;
...
};
```

`glx_screen` 同時保存 server 回報的 GLX capability 與 client 最後能使用的 `effectiveGLXexts`。 Mesa 會把 server 字串、client 建置時啟用的功能、direct backend、loader 與 driver capability 合併成實際可用的 extension 集合。 `dpy` 與 `scr` 則把這份 client-side screen wrapper 固定到一條 X connection 與其中一個 Screen

三個 vtable 把 screen、context 與 drawable 的操作分開。 後面建立 direct context 時會走 `glx_screen_vtable::create_context_attribs`，make-current 會走 context vtable 的 bind，swap 則由 drawable 所在 screen 的 DRI hooks 處理。 這些 callback 所選 backend 可以不同，公開 GLX object 的外形仍保持一致

Xorg 的 display state 先成立，GLX client 才利用 `Display *` 與 Root Window 找到正確的 Screen 與 rendering device。 這條主線在 swap 時交出 drawable 與 presentation request，顯示端接手後的內部工作位於該公開交界另一側

還要區分 front storage 與 application 將要畫的 resource。 Xorg 的 front BO 服務整個 X Screen 或目前顯示組態。 application 的 default framebuffer backing 則屬於某個 GLX drawable 的 buffer pool，可能在 swap 後成為 Present source，也可能先被複製或合成。 兩者有機會在特定組態中共享 storage，卻沒有固定的一對一生命週期

`GLXFBConfig` 在 client 端可轉成 `glx_config`。 `GLXContext` 則是 `glx_context` wrapper 的公開 view，wrapper 內同時保存 X11 protocol identity 與 backend 的私有 pointer

drawable 也有兩層 identity。 GLX API 使用 `GLXDrawable`，其值落在 X11 XID namespace。 direct 路徑查找或建立 client-side DRI drawable wrapper，再由 wrapper 取得 backend drawable。 context 建立不需要先綁定 draw 或 read drawable，所以 context object 與 framebuffer binding 的生命週期分開。 這個延後綁定正是 make-current 要負責的工作

#### GLX object 先保存 X11 identity，再接 DRI object

Mesa GLX 正要配置公開 `GLXContext` wrapper，呼叫端已有 `glx_screen`、`glx_config` 與 optional `share_list`。 要判斷後續 bind、server request 與 destroy 各使用哪個 identity，必須看 wrapper 同時保存的 XID、screen pointer、backend pointer 與 current-display 欄位。 以下從 `struct glx_context` 的欄位找出 protocol namespace 與 client pointer chain

同一個 struct 稍後保存 `isDirect` 與 `driContext`。 前者決定 bind 路徑，後者是 backend 的私有 state。 current display 與 drawable 只在成功 make-current 後填入

以下程式碼來自 [Mesa: src/glx/glxclient.h:274](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L274-289) 與 [Mesa: src/glx/glxclient.h:335](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L335-344) 的 `struct glx_context`。 欄位顯示 `xid` 記錄 server-side context identity，`driContext` 保存 backend 的私有 pointer，`currentDpy` 則維持 current state：

```c
...
   const struct glx_context_vtable *vtable;

    /**
     * The XID of this rendering context.  When the context is created a
     * new XID is allocated.  This is set to None when the context is
     * destroyed but is still current to some thread. In this case the
     * context will be freed on next MakeCurrent.
     */
   XID xid;

    /**
     * The XID of the \c shareList context.
     */
   XID share_xid;

   struct glx_screen *psc;
...
   Bool isDirect;

   /* Backend private state for the context */
   void *driContext;

    /**
     * \c dpy of current display for this context.  Will be \c NULL if not
     * current to any display, or if this is the "dummy context".
     */
   Display *currentDpy;
...
```

以下程式碼來自 [`Mesa: src/glx/glxclient.h:635`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L635-641) 的 `struct glx_drawable`，用來證明 drawable wrapper 保存 XID 與 swap counter，不直接保存 Gallium storage

```c
...
struct glx_drawable {
   XID xDrawable;
   XID drawable;

   uint32_t lastEventSbc;
   int64_t eventSbcWrap;
};
```

`glx_drawable` 裡的兩個 XID 具有不同用途。 `xDrawable` 保存 application 交進來的 native X drawable 名稱，`drawable` 則可保存實際送進 GLX protocol 或相關 resource 操作的 XID。 兩者都是 X server namespace 內的整數名稱。 底層 resource 另由 DRI drawable 與 loader buffer reference 表示

`lastEventSbc` 與 `eventSbcWrap` 顯示 drawable 還要追蹤 swap event 的序號資訊。 OpenGL framebuffer attachment 保存 rendering 內容，這兩個欄位則保存 presentation bookkeeping，直到視窗系統端回報相應結果

真正的 rendering resource 會在 DRI drawable 驗證與 buffer 配置過程中接到 Mesa。 XID 用來找到 drawable，drawable 觸發 loader 取得或建立 buffer，buffer 再以 framebuffer attachment 與 Gallium resource 的形式成為 OpenGL draw 的輸出

`GLXContext` 在這份 client 實作中是可轉回 `struct glx_context *` 的 handle，`gc->xid` 是送進 X request 的 protocol resource ID。 Application 把 `GLXContext` 傳入公開 API，Mesa 內部建立 server-side resource 時則將 `gc->xid` 寫入 protocol 欄位，兩者分屬 pointer 與 XID namespace

`driContext` 是 `void *`，因為 GLX common layer 不固定 backend struct layout。 Direct Gallium 路徑存放 `struct dri_context *`，destroy vtable 將它交給 DRI frontend 清理。 indirect wrapper 則使用自己的私有 state 與 vtable。 local `pipe_context` 是 direct DRI context 建立路徑的結果

context 也保存建立時的 config 與 read binding。 [Mesa: src/glx/glxclient.h:381](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L378-389) 的 `config` 指回 `glx_config`，`currentReadable` 與前段的 `currentDrawable` 分開

draw 與 read 可以是同一 XID，也可以是兩個 XID。 兩個欄位相等時仍是兩個 API role，backend 可以在 bind 時共用同一 drawable object

FBConfig 亦跨兩個 namespace，但方式不同。 `glx_config` 保存 screen 與 `fbconfigID`，讓 X request 能攜帶 server 認得的 ID。 direct 路徑的私有 config wrapper 另有 `driConfig`，供 DRI frontend 選擇 color、depth 與其他 framebuffer mode

GLVND mapping 使用公開 FBConfig identity，Mesa GLX 建立再把它轉回 client config pointer。 這些 lookup 是逐層轉換，不是同一個 pointer 直接穿越所有 ABI

client wrapper、X server resource 與 direct renderer objects 的關係可整理為：

- `Display *` 經 Mesa per-display state 找到 `glx_screen`
- `glx_config` 同時保存 server FBConfig ID 與 direct backend 的 DRI config
- `glx_context` wrapper 保存 context／share XID、current draw／read XID，以及 backend `driContext` pointer

下一小節從 `glXCreateContextAttribsARB()` 的實際分支開始，追蹤這些欄位如何建立 `glx_context` wrapper 與 `dri_context`，以及 DRI frontend 如何把 renderer context 的建立工作交給 `st_api_create_context()`

object graph 的 owner 由建立與 destroy 路徑決定。 X server 管理 XID resource。 Mesa GLX 管理 client wrapper 與 current-binding 欄位。 DRI frontend 管理 `dri_context`，State Tracker 與 Gallium 再管理更內層 context。 只看到 `gc`、`xid` 或 `driContext` 其中一個，均不足以宣稱其他層的 object 已存在或仍存活

#### Direct context 建立

公開 `glXCreateContextAttribsARB()` 已將 handles 轉成 `glx_config` 與 optional sharing wrapper，現在要在 direct／indirect 分支中建立真正 context。 Direct vtable 的選擇點、sharing restrictions 的驗證層，以及 GLX wrapper 與 DRI context 的交接，共同界定每個回傳點已建立哪些 object。 以下從公開分支逐層追到 `st_api_create_context()` 的呼叫邊界

direct 選擇點位於 attribute normalization 之後。 screen 可以要求把原本的 indirect request 強制改成 direct，接著透過 `psc` 的 `vtable.create_context_attribs` 建立 direct wrapper。 若仍是 indirect，則進入另一個建立函式

以下程式碼來自 [Mesa: src/glx/create_context.c:46](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/create_context.c#L45-56) 與 [Mesa: src/glx/create_context.c:121](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/create_context.c#L121-139) 的 `glXCreateContextAttribsARB()`。 入口判斷條件顯示公開 config／sharing handles 先轉回 client wrappers，套用 `force_direct_context` 後，再由 `direct` 與 `create_context_attribs` 選擇 screen vtable 或 indirect constructor：

```c
GLXContext
glXCreateContextAttribsARB(Display *dpy, GLXFBConfig config,
                           GLXContext share_context, Bool direct,
                           const int *orig_attrib_list)
{
   xcb_connection_t *const c = XGetXCBConnection(dpy);
   struct glx_config *const cfg = (struct glx_config *) config;
   struct glx_context *const share = (struct glx_context *) share_context;
   struct glx_context *gc = NULL;
   unsigned num_attribs = 0;
   struct glx_screen *psc;
   xcb_generic_error_t *err;
...
   /* Some application may request an indirect context but we may want to force a direct
    * one because Xorg only allows indirect contexts if they were enabled.
    */
   if (!direct &&
       psc->force_direct_context) {
      direct = true;
   }

   if (direct && psc->vtable->create_context_attribs) {
      gc = psc->vtable->create_context_attribs(psc, cfg, share, num_attribs,
                      (const uint32_t *) attrib_list,
                      &error);
   } else if (!direct) {
#if defined(GLX_INDIRECT_RENDERING)
      gc = indirect_create_context_attribs(psc, cfg, share, num_attribs,
                                           (const uint32_t *) attrib_list,
                                           &error);
#endif
   }
...
}
```

screen vtable 的 direct 實作是 `dri_create_context_attribs`。 它先把 GLX attributes 轉成 DRI context attributes，並以 config 檢查 render type。 sharing context 若為 indirect 會立即失敗，因為 direct DRI context 無法直接共享 indirect server context。 no-error mode 也必須與 sharing context 相符

以下程式碼來自 [Mesa: src/glx/dri_common.c:795](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri_common.c#L794-824) 的 `dri_create_context_attribs()`，用來確認 attribute 驗證與 sharing 分支的失敗結果。 `dri_convert_glx_attribs()` 和 `validate_renderType_against_config()` 先決定 error 路徑，sharing 分支只接受 direct `shareList` 的 backend pointer，indirect context 會回傳 `BadMatch`：

```c
struct glx_context *
dri_create_context_attribs(struct glx_screen *base,
                           struct glx_config *config_base,
                           struct glx_context *shareList,
                           unsigned num_attribs,
                           const uint32_t *attribs,
                           unsigned *error)
{
   struct glx_context *pcp = NULL;
   __GLXDRIconfigPrivate *config = (__GLXDRIconfigPrivate *) config_base;
   struct dri_context *shared = NULL;

   struct dri_ctx_attribs dca;
   uint32_t ctx_attribs[2 * 6];
   unsigned num_ctx_attribs = 0;

   *error = dri_convert_glx_attribs(num_attribs, attribs, &dca);
   if (*error != __DRI_CTX_ERROR_SUCCESS)
      goto error_exit;

   /* Check the renderType value */
   if (!validate_renderType_against_config(config_base, dca.render_type)) {
      *error = BadValue;
      goto error_exit;
   }

   if (shareList) {
      /* We can't share with an indirect context */
      if (!shareList->isDirect)
         return NULL;
...
   }
...
}
```

驗證成功後，函式配置 `glx_context` wrapper，執行 `glx_context_init`，再組出 DRI attribute pairs。 `shared` 取自 `shareList` 的 `driContext`，因此 sharing 沿著同一 backend layer 傳遞。 wrapper 本身會留在 GLX layer，新的 DRI pointer 則寫入 `pcp` 的 `driContext`

以下程式碼來自 [Mesa: src/glx/dri_common.c:883](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri_common.c#L878-901) 的 `dri_create_context_attribs()` 後半段。 欄位寫入顯示 `dca.render_type` 先寫入 wrapper，`driCreateContextAttribs()` 的結果則保存到 `pcp->driContext`。 DRI error 會轉成 GLX error，null backend 走 `error_exit`，成功才安裝 context vtable 並回傳 `pcp`：

```c
struct glx_context *
dri_create_context_attribs(struct glx_screen *base,
                           struct glx_config *config_base,
                           struct glx_context *shareList,
                           unsigned num_attribs,
                           const uint32_t *attribs,
                           unsigned *error)
{
...
   /* The renderType is retrieved from attribs, or set to default
    *  of GLX_RGBA_TYPE.
    */
   pcp->renderType = dca.render_type;

   pcp->driContext =
      driCreateContextAttribs(base->frontend_screen,
                              dca.api,
                              config ? config->driConfig : NULL,
                              shared,
                              num_ctx_attribs / 2,
                              ctx_attribs,
                              error,
                              pcp,
                              x11_xlib_display_is_thread_safe(base->dpy));

   *error = dri_context_error_to_glx_error(*error);

   if (pcp->driContext == NULL)
      goto error_exit;

   pcp->vtable = base->context_vtable;

   return pcp;
...
}
```

`driCreateContextAttribs` 是 DRI frontend 的 attribute translation wrapper。 它把 DRI API enum 與 attribute pairs 轉成 `gl_api` 和 `__DriverContextConfig`，完成版本與 flag 檢查後呼叫 `dri_create_context`

這一層的 `data` 正是 `pcp`，稍後保存在 `dri_context.loaderPrivate`。 所以 GLX wrapper 可以作為 loader 的私有 identity 回到 drawable 與 callback 路徑，但它仍不等於 `dri_context`

DRI wrapper 完成 attribute translation 後，context 建立會進入 Gallium DRI frontend。 此時 profile、version、context flags、visual、optional sharing context 與 loader 的私有 identity 都已整理成 `dri_create_context()` 可以接收的輸入

以下程式碼來自 [Mesa: src/gallium/frontends/dri/dri_context.c:153](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L153-181) 的 `dri_create_context()` 配置與 handoff 路徑。 這裡保留 sharing pointer、`loaderPrivate`、visual 與 `st_api_create_context()` 的交接，State Tracker 如何建立內層 contexts 則由後面的 State Tracker 章展開：

```c
struct dri_context *
dri_create_context(struct dri_screen *screen,
                   gl_api api, const struct gl_config *visual,
                   const struct __DriverContextConfig *ctx_config,
                   unsigned *error,
                   struct dri_context *sharedContextPrivate,
                   void *loaderPrivate,
                   bool thread_safe)
{
...
   struct dri_context *share_ctx = NULL;
   if (sharedContextPrivate) {
      share_ctx = (struct dri_context *)sharedContextPrivate;
      st_share = share_ctx->st;
   }

   ctx = CALLOC_STRUCT(dri_context);
   if (ctx == NULL) {
      *error = __DRI_CTX_ERROR_NO_MEMORY;
      goto fail;
   }

   ctx->screen = screen;
   ctx->loaderPrivate = loaderPrivate;

...
   attribs.options = screen->options;
   dri_fill_st_visual(&attribs.visual, screen, visual);
   ctx->st = st_api_create_context(&screen->base, &attribs, &ctx_err,
				   st_share);
...
}
```

`st_api_create_context()` 接收 `screen->base` 這個 `pipe_frontend_screen`、轉換完成的 attributes、錯誤輸出位置與 optional shared `st_context`

成功回傳的 `st_context` 會保存到 `dri_context::st`。 若回傳 `NULL`，`dri_create_context()` 會把 `st_context_error` 轉成 DRI context error，並回收已配置的 DRI object。 GLX／DRI 在此把 renderer context 的建立工作交給 State Tracker

`st_api_create_context()` 成功回傳後，client-side renderer context chain 已建立，但 context 仍未 current。 draw 與 read framebuffer 要等 drawable lookup 與 make-current binding 才會接上。 application 因此可以先建立多個 contexts，再選擇要在哪個執行緒與 drawable 上使用它們

```callgraph
Mesa GLX 公開 context 的建立
=================================================
[Mesa: src/glx/create_context.c:46] glXCreateContextAttribsARB()
  │
  │  cfg = (struct glx_config *)config;
  │  share = (struct glx_context *)share_context;
  │
  ├─ if (!direct && psc->force_direct_context)：direct = true
  ├─ direct && psc->vtable->create_context_attribs != NULL
  │    └─ gc = psc->vtable->create_context_attribs(psc, cfg, share, ...)
  └─ !direct：indirect_create_context_attribs(...)
       // direct 分支 handoff：screen、DRI config、sharing wrapper、attributes
       ↓
[Mesa: src/glx/dri_common.c:795] dri_create_context_attribs()
  │
  ├─ dri_convert_glx_attribs(...) 失敗：goto error_exit
  ├─ render type incompatible with config：BadValue; goto error_exit
  ├─ shareList != NULL && !shareList->isDirect：return NULL
  └─ shared = shareList ? shareList->driContext : NULL
       ↓
[Mesa: src/glx/dri_common.c:883] dri_create_context_attribs() backend handoff
  │
  │  pcp->driContext = driCreateContextAttribs(
  │      base->frontend_screen, dca.api, config->driConfig,
  │      shared, ..., pcp, thread_safe);
  ├─ pcp->driContext == NULL：goto error_exit
  └─ pcp->vtable = base->context_vtable; return pcp
       // GLX wrapper pcp 保存 backend dri_context pointer
       ↓

Gallium DRI frontend 到 State Tracker 的 handoff
=================================================
[Mesa: src/gallium/frontends/dri/dri_util.c:421] driCreateContextAttribs()
  │
  └─ [Mesa: src/gallium/frontends/dri/dri_util.c:612] dri_create_context(...)
     dri_create_context(screen, mesa_api, visual, &config, error,
                        shared, data, thread_safe)
       ↓
[Mesa: src/gallium/frontends/dri/dri_context.c:46] dri_create_context()
  │
  ├─ CALLOC_STRUCT(dri_context) == NULL
  │    └─ *error = __DRI_CTX_ERROR_NO_MEMORY; goto fail
  ├─ ctx->screen = screen;
  ├─ ctx->loaderPrivate = loaderPrivate;
  ├─ dri_fill_st_visual(&attribs.visual, screen, visual)
  └─ ctx->st = st_api_create_context(&screen->base, &attribs,
                                      &ctx_err, st_share)
       │
       │  // handoff：frontend screen、context attributes、
       │  // optional shared st_context 與 error output
       ├─ 回傳 NULL：將 ctx_err 轉成 DRI context error；goto fail
       └─ 成功：ctx->st 保存 State Tracker context
```

#### X server bookkeeping 側支

client 行程內的 `glx_context`、`dri_context` 與 renderer context chain 已建立，但 X server 還沒有對應的 GLX resource。 公開的 context 建立呼叫必須先完成 server-side bookkeeping，才能把有效的 `GLXContext` 交給 application

create 呼叫因此用 `Display` connection 產生 XID，帶著 FBConfig ID、screen、share XID 與 direct flag 送 request。 若 server 拒絕，這個分支必須銷毀先前建立的 local chain

以下讀 request assignment、`xcb_request_check()` 與兩個結果分支，以確認 server-side bookkeeping 的輸入與失敗清理

以下程式碼來自 [Mesa: src/glx/create_context.c:172](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/create_context.c#L160-192) 的 `glXCreateContextAttribsARB()`，用來確認 client backend context 建立後還會傳送 XID／FBConfig／attributes request，並在 X server 拒絕時銷毀本地 context chain：

```c
GLXContext
glXCreateContextAttribsARB(Display *dpy, GLXFBConfig config,
                           GLXContext share_context, Bool direct,
                           const int *orig_attrib_list)
{
...
   xid = xcb_generate_id(c);
   share_xid = (share != NULL) ? share->xid : 0;
...
   cookie =
      xcb_glx_create_context_attribs_arb_checked(c,
                                                 xid,
                                                 cfg ? cfg->fbconfigID : 0,
                                                 screen,
                                                 share_xid,
                                                 gc->isDirect,
                                                 num_attribs,
                                                 (const uint32_t *)
                                                 attrib_list);
   err = xcb_request_check(c, cookie);
   if (err != NULL) {
      if (gc)
         gc->vtable->destroy(gc);
      gc = NULL;

      __glXSendErrorForXcb(dpy, err);
      free(err);
   } else {
      gc->xid = xid;
      gc->share_xid = share_xid;
   }
...
}
```

request 成功後才會將新 XID 與 share XID 寫入 `gc`。 這個順序使尚未由 server 接受的 ID 不會先成為 wrapper 的有效 protocol identity。 request 失敗時，code 呼叫 context vtable 的 destroy，direct 路徑會沿著 `driContext` 清理 client renderer objects，接著將 `gc` 設成空值並送出對應 X error

對 direct 路徑而言，client 呼叫鏈建立 local `pipe_context` 與 `st_context`，server request 則建立公開 GLX resource。 Request 攜帶 context XID、sharing XID 與 attributes，讓 X server 完成驗證與後續 protocol bookkeeping。 local renderer pointers 仍由 client 行程持有

```callgraph
Mesa GLX client / X server bookkeeping 邊界
=================================================
[Mesa: src/glx/create_context.c:46] glXCreateContextAttribsARB()
  │
  │  // direct 分支已建立 gc 與 backend context chain
  │  xid = xcb_generate_id(c);
  │  share_xid = share != NULL ? share->xid : 0;
  ↓
[Mesa: src/glx/create_context.c:172] xcb_glx_create_context_attribs_arb_checked()
  │
  │  request = { xid, cfg->fbconfigID, screen, share_xid,
  │              gc->isDirect, num_attribs, attrib_list };
  │  err = xcb_request_check(c, cookie);
  │  // 行程邊界：request 只傳 XID／config／attributes，不傳 local pointers
  │
  ├─ err != NULL
  │    ├─ gc->vtable->destroy(gc)       // unwind DRI、ST 與 pipe contexts
  │    ├─ gc = NULL
  │    ├─ __glXSendErrorForXcb(dpy, err)
  │    └─ free(err)
  │         // 最終結果：公開建立失敗，local chain 已回收
  │
  └─ err == NULL
       ├─ gc->xid = xid
       └─ gc->share_xid = share_xid
            // 最終結果：client wrapper 取得 server-accepted protocol identity
```

建立完成後，application 手上的 `GLXContext` 同時能導向兩條關係。 client pointer chain 通往 Mesa renderer context，`gc` 的 `xid` 則通往 X server GLX resource。 下一次 make-current 會同時使用 client object 與 drawable XID，但兩條 identity 仍不會合併成一個 object

### Make-current 與執行緒區域 dispatch

context 建立已回傳 `GLXContext`，application 現在以 draw／read `GLXDrawable` 呼叫 make-current。 這次切換要先解除舊 context，再取得新的 DRI drawable references，建立或重用 winsys framebuffer，最後發布 GLX 與 GLAPI TLS。 任一 bind 失敗都會影響目前執行緒是否仍有可用 context，因此必須沿 direct／indirect vtable 與 teardown 順序讀 source

切換會改動多個 pointer。 old context 要先 unbind，new context 經過執行緒 exclusivity 與 drawable 驗證後才能公布。 bind 失敗時，舊 context 已解除，執行緒保持 null 或 dummy current

#### Direct bind 路徑

application 把 direct `GLXContext`、draw XID 與 read XID 交給 `MakeContextCurrent()`，舊 wrapper 仍可能 current。 要判斷失敗後執行緒留下舊 context、null state 還是新 context，必須先讀 common 路徑的驗證／unbind／publish order，再讀 `dri_bind_context()` 對 drawable lookup 與 `dri_make_current()` 對 reference 的處理。 公開入口與 lock 位於 [`Mesa: src/glx/glxcurrent.c:106`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcurrent.c#L105-132)

lock 內先 unbind old context 並清除 `currentDpy`。 已 destroy 但仍 current 的 wrapper 以 `xid == None` 表示延後銷毀，switch-away 時才真正 destroy。 接著 `__glXSetCurrentContextNull` 安裝 dummy GLX context 與空 GLAPI state

new wrapper 的 `currentDpy` 已有值時，common 路徑回報 `BadAccess`。 vtable bind 在 current 欄位公布前執行，成功後才設定 display、兩個 drawable 欄位與 GLX TLS。 這段順序位於 [Mesa: src/glx/glxcurrent.c:146](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcurrent.c#L146-176)

direct vtable 使用 `dri_bind_context`。 它依 draw 與 read XID 取得 DRI drawable wrapper，釋放舊 references，並在 lookup 失敗時回傳 `GLXBadDrawable`。 有效 backend drawable 與 `context` 的 `driContext` 再交給 `driBindContext`

以下程式碼來自 [Mesa: src/glx/dri_common.c:742](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri_common.c#L741-774) 的 `dri_bind_context()`。 回傳分支顯示函式先 fetch draw／read wrappers 並釋放舊 references，非 `None` XID lookup 失敗分別回傳 `GLXBadDrawable`，backend bind 失敗回傳 `GLXBadContext`，只有三項都成功才回傳 `Success`：

```c
Bool
dri_bind_context(struct glx_context *context, GLXDrawable draw, GLXDrawable read)
{
   __GLXDRIdrawable *pdraw, *pread;
   struct dri_drawable *dri_draw = NULL, *dri_read = NULL;

   pdraw = driFetchDrawable(context, draw);
   pread = driFetchDrawable(context, read);

   driReleaseDrawables(context);

   if (pdraw)
      dri_draw = pdraw->dri_drawable;
   else if (draw != None)
      return GLXBadDrawable;

   if (pread)
      dri_read = pread->dri_drawable;
   else if (read != None)
      return GLXBadDrawable;

   if (!driBindContext(context->driContext, dri_draw, dri_read))
      return GLXBadContext;
...
   return Success;
}
```

以下程式碼來自 [Mesa: src/gallium/frontends/dri/dri_context.c:303](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L303-343) 的 `dri_make_current()`，用來確認三條回傳路徑對 drawable 組合與布林結果的處理。 draw／read 只有一方非 null 時立即回傳 `GL_FALSE`，兩者皆 null 時直接傳遞 `st_api_make_current()` 的結果，drawable 分支完成 handoff 後則固定回傳 `GL_TRUE`：

```c
bool
dri_make_current(struct dri_context *ctx,
		 struct dri_drawable *draw,
		 struct dri_drawable *read)
{
...
   if ((draw && !read) || (!draw && read))
      return GL_FALSE; /* only both non-NULL or both NULL are allowed */
...
   if (!draw && !read)
      return st_api_make_current(ctx->st, NULL, NULL);
...
   st_api_make_current(ctx->st, &draw->base, &read->base);

   return GL_TRUE;
}
```

null-drawable 分支會直接回傳 `st_api_make_current()` 的 bool。 drawable 分支則呼叫它後忽略 bool，最後無條件回傳 `GL_TRUE`。 因此 GLX common layer 確實只在 vtable bind 回報 `Success` 時公布 `gc` 的 TLS，但不能宣稱 State Tracker 在重用或配置 framebuffer 時發生的失敗，以及 `_mesa_make_current()` 的失敗，都會回傳 GLX bind error

```callgraph
Mesa GLX common make-current
=================================================
[Mesa: src/glx/glxcurrent.c:106] MakeContextCurrent(dpy, draw, read, gc, opcode)
  │
  ├─ if (gc != NULL && gc->xid == None)：return GL_FALSE
  ├─ exactly one of draw/read is zero：send BadMatch; return False
  ├─ old binding equals requested binding：return True
  └─ oldGC->vtable->unbind(oldGC);
     __glXSetCurrentContextNull();       // 舊 binding 已解除，先發布 null state
     │
     ├─ gc->currentDpy != NULL：send BadAccess; return False
     └─ gc->vtable->bind(gc, draw, read)
          ↓

Mesa GLX direct backend / Gallium DRI frontend
=================================================
[Mesa: src/glx/dri_common.c:742] dri_bind_context()
  │
  │  pdraw = driFetchDrawable(context, draw);
  │  pread = driFetchDrawable(context, read);
  │  driReleaseDrawables(context);
  ├─ missing non-None draw/read wrapper：return GLXBadDrawable
  ├─ !driBindContext(context->driContext, dri_draw, dri_read)
  │    └─ return GLXBadContext
  └─ return Success
       ↓
[Mesa: src/gallium/frontends/dri/dri_context.c:304] dri_make_current()
  │
  ├─ exactly one of draw/read is NULL：return GL_FALSE
  ├─ draw == NULL && read == NULL
  │    └─ return st_api_make_current(ctx->st, NULL, NULL)
  └─ drawable 分支
       ├─ ctx->draw = draw; ctx->read = read
       ├─ dri_get_drawable(draw)
       ├─ draw != read：dri_get_drawable(read)
       ├─ st_api_make_current(ctx->st, &draw->base, &read->base)
       └─ return GL_TRUE
            // 固定版本的 drawable 分支沒有向上傳遞 ST bool
            ↓

Mesa GLX current-state publication
=================================================
[Mesa: src/glx/glxcurrent.c:166] if (gc->vtable->bind(gc, draw, read) != Success)
  │
  ├─ bind != Success：ret = GL_FALSE。 執行緒維持 null current state
  └─ bind == Success
       ├─ gc->currentDpy = dpy
       ├─ gc->currentDrawable = draw
       ├─ gc->currentReadable = read
       └─ __glXSetCurrentContext(gc)
            // 最終結果：new GLX wrapper 與 GLAPI state 對呼叫端執行緒可見
```

#### Indirect bind 路徑

若 `GLXContext` 的 vtable 指向 indirect backend，呼叫端執行緒手上仍有 context XID、old context tag 與 draw／read XIDs，但沒有 local `pipe_context`。 要判斷 GL 公開 stubs 之後會進 Mesa renderer 還是 protocol encoder，必須讀 `SendMakeCurrentRequest()` 的 request 分支、reply tag 與 `indirect_bind_context()` 安裝的 `IndirectAPI`

[Mesa: src/glx/indirect_glx.c:80](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/indirect_glx.c#L79-121) 顯示兩種 request layout、reply 與 context tag 回填

reply 的 `contextTag` 會寫入 `out_tag`，供後續 indirect commands 標示 server context。 它與 `gc` 的 `xid` resource identity 用途不同，也不是 direct 路徑的 `dri_context` pointer

request 成功後，`indirect_bind_context` lazy-create 行程共用的 `IndirectAPI`，再安裝到呼叫端執行緒。 其 GL slots 指向 protocol encoders，公開 stub 仍走執行緒區域 dispatch，但 target 會編碼 GLX render commands

以下程式碼來自 [Mesa: src/glx/indirect_glx.c:124](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/indirect_glx.c#L123-156) 的 `indirect_bind_context()`。 Request 路徑顯示 `SendMakeCurrentRequest()` 寫回 `currentContextTag`。 request 成功後才配置 `IndirectAPI`、安裝 protocol dispatch，並在第一次使用時暫時發布 GLX TLS 以初始化 client-side vertex array state，最後以 `!sent` 符合 vtable 的零成功值：

```c
static int
indirect_bind_context(struct glx_context *gc,
            GLXDrawable draw, GLXDrawable read)
{
   Display *dpy = gc->psc->dpy;
   Bool sent;

   sent = SendMakeCurrentRequest(dpy, gc->xid, 0, draw, read,
             &gc->currentContextTag);

   if (sent) {
      if (!IndirectAPI)
         IndirectAPI = __glXNewIndirectAPI();
      _mesa_glapi_set_dispatch(IndirectAPI);
...
      __GLXattribute *state = gc->client_state_private;
      if (state && state->array_state == NULL) {
         gc->currentDpy = gc->psc->dpy;
         __glXSetCurrentContext(gc);
         __indirect_glGetString(GL_EXTENSIONS);
         __indirect_glGetString(GL_VERSION);
         __glXInitVertexArrayState(gc);
      }
   }

   return !sent;
}
```

vtable contract 使用零表示 `Success`，所以函式回傳 `!sent`。 reply 成功後，common 路徑才填入正式 current 欄位。 第一次初始化 client-side vertex array state 需要查 server 字串，code 會暫時設定 `currentDpy` 與 GLX TLS

indirect unbind 以目前 tag 送出 context 與兩個 drawable 都為 `None` 的 request，再將 tag 歸零。 [Mesa: src/glx/indirect_glx.c:159](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/indirect_glx.c#L158-165) 顯示完整 body

Direct 與 indirect 共用外層驗證、locking 與 GLX TLS 生命週期，分岔位於 context vtable。 Direct 路徑安裝 `gl_context` dispatch 並有 local `pipe_context`，indirect 路徑安裝 protocol encoder table。 `_mesa_glapi_tls_Dispatch` 因而可以指向 local renderer 或 indirect encoder 兩種實作

#### Draw／read framebuffer reference 與 current context teardown

direct bind 成功後，GLX TLS、Mesa context TLS、dispatch table、DRI draw／read references 與 winsys framebuffer references 都指向這次 binding

application 下一次切換或 unbind 時，釋放順序會決定 framebuffer surface 是否提早失效或洩漏

以下程式碼來自 [`Mesa: src/glx/glxcurrent.c:55`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcurrent.c#L55-78) 的 `__glXSetCurrentContext()` 與 `__glXSetCurrentContextNull()`。 TLS 欄位寫入顯示 slot 永遠指向 real wrapper 或 `dummyContext`。 null transition 另外安裝 no-op GL dispatch 並清掉 Mesa current-context pointer，使兩套執行緒區域 state 一起回到安全基線：

```c
/**
 * Per-thread GLX context pointer.
 *
 * \c __glXSetCurrentContext is written is such a way that this pointer can
 * \b never be \c NULL.  This is important!  Because of this
 * \c __glXGetCurrentContext can be implemented as trivial macro.
 */
__THREAD_INITIAL_EXEC void *__glX_tls_Context = &dummyContext;

void
__glXSetCurrentContext(struct glx_context * c)
{
   __glX_tls_Context = (c != NULL) ? c : &dummyContext;
}

void
__glXSetCurrentContextNull(void)
{
   __glXSetCurrentContext(&dummyContext);
#if defined(GLX_DIRECT_RENDERING)
   _mesa_glapi_set_dispatch(NULL);   /* no-op functions */
   _mesa_glapi_set_context(NULL);
#endif
}
```

DRI layer 持有 draw 與 read references。 兩者相同時只增加一次，不同時各增加一次，隨後交給 `st_api_make_current`。 [Mesa: src/gallium/frontends/dri/dri_context.c:328](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L328-343) 顯示此條件，也顯示 drawable 分支不傳遞呼叫的 bool

State Tracker reuse 或建立 `gl_framebuffer`。 draw 與 read 相同時，read role 取得同一 object 的 reference

`st_api_make_current` 完成自己的驗證、呼叫 Mesa core，再釋放 local references。 [Mesa: src/mesa/state_tracker/st_manager.c:1146](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L1145-1189) 顯示 handoff。 這個函式的結果只在 DRI null-drawable 分支完整向上傳遞

Mesa core 的 bind 分支先設定 context TLS，再選擇 `newCtx` 的 `GLApi` dispatch。 draw 與 read 都存在時，兩個 winsys 欄位各取得 reference。 unbind 分支安裝 no-op dispatch、釋放 references，再清掉 context TLS

以下程式碼來自 [Mesa: src/mesa/main/context.c:1451](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1485-1507) 的 `_mesa_make_current()`。 兩條分支可觀察 unbind 如何先安裝 no-op dispatch、放掉 `WinSysDrawBuffer`／`WinSysReadBuffer` references，再清除 context TLS。 bind 則先發布 `newCtx` 與 `GLApi` table，之後才讓兩個 winsys 欄位取得新 framebuffer references：

```c
GLboolean
_mesa_make_current(struct gl_context *newCtx,
                   struct gl_framebuffer *drawBuffer,
                   struct gl_framebuffer *readBuffer)
{
...
   if (!newCtx) {
      _mesa_glapi_set_dispatch(NULL);  /* none current */
      /* We need old ctx to correctly release Draw/ReadBuffer
       * and avoid a surface leak in st_renderbuffer_delete.
       * Therefore, first drop buffers then set new ctx to NULL.
       */
      if (curCtx) {
         _mesa_reference_framebuffer(&curCtx->WinSysDrawBuffer, NULL);
         _mesa_reference_framebuffer(&curCtx->WinSysReadBuffer, NULL);
      }
      _mesa_glapi_set_context(NULL);
      assert(_mesa_get_current_context() == NULL);
   }
   else {
      _mesa_glapi_set_context((void *) newCtx);
      assert(_mesa_get_current_context() == newCtx);
      _mesa_set_dispatch(newCtx, newCtx->GLApi);

      if (drawBuffer && readBuffer) {
         assert(_mesa_is_winsys_fbo(drawBuffer));
         assert(_mesa_is_winsys_fbo(readBuffer));
         _mesa_reference_framebuffer(&newCtx->WinSysDrawBuffer, drawBuffer);
         _mesa_reference_framebuffer(&newCtx->WinSysReadBuffer, readBuffer);
...
      }
      ...
   }
   ...
   return GL_TRUE;
}
```

DRI unbind 反向釋放 references。 current `st_context` 先等 glthread 完成，再呼叫 `st_api_make_current(NULL, NULL, NULL)`

接著每個獨立 drawable 各 `dri_put_drawable` 一次並清空欄位。 [Mesa: src/gallium/frontends/dri/dri_context.c:273](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L271-301) 顯示完整 unbind

teardown 由外往內進行。 GLX common layer unbind old wrapper 並安裝 dummy state，DRI layer 放掉 drawable references，Mesa core 則釋放 framebuffer 並清除 TLS。 仍 current 的已 destroy wrapper 會延後到 switch-away 才真正釋放

```callgraph
Mesa GLX common switch-away
=================================================
[Mesa: src/glx/glxcurrent.c:106] MakeContextCurrent()
  │
  ├─ if (oldGC != &dummyContext)
  │    ├─ oldGC->vtable->unbind(oldGC)
  │    ├─ oldGC->currentDpy = NULL
  │    └─ oldGC->xid == None：oldGC->vtable->destroy(oldGC)
  └─ __glXSetCurrentContextNull()
       ↓
[Mesa: src/glx/glxcurrent.c:71] __glXSetCurrentContextNull()
  │
  ├─ __glX_tls_Context = &dummyContext
  ├─ _mesa_glapi_set_dispatch(NULL)      // 安裝 no-op table
  └─ _mesa_glapi_set_context(NULL)

Direct DRI unbind
=================================================
[Mesa: src/gallium/frontends/dri/dri_context.c:273] dri_unbind_context()
  │
  ├─ st == st_api_get_current()
  │    ├─ _mesa_glthread_finish(st->ctx)
  │    └─ st_api_make_current(NULL, NULL, NULL)
  │         ↓
  │       [Mesa: src/mesa/main/context.c:1451] _mesa_make_current(NULL, NULL, NULL)
  │         ├─ 釋放 WinSysDrawBuffer／WinSysReadBuffer references
  │         ├─ install no-op GL dispatch
  │         └─ clear Mesa context TLS
  └─ ctx->draw || ctx->read
       ├─ dri_put_drawable(ctx->draw)
       ├─ read != draw：dri_put_drawable(ctx->read)
       └─ ctx->draw = ctx->read = NULL
            // 最終結果：framebuffer 與 DRI drawable references 已釋放

Indirect GLX unbind
=================================================
[Mesa: src/glx/indirect_glx.c:159] indirect_unbind_context()
  │
  ├─ SendMakeCurrentRequest(dpy, None, currentContextTag, None, None, NULL)
  └─ gc->currentContextTag = 0
       // 最終結果：server context unbound，client 回到 dummy/no-op current state
```

執行期 artifact 與 GLVND mapping 先選到 Mesa vendor，make-current 再安裝執行緒區域 context、dispatch 以及 draw 與 read references。 GLX common layer 看見 vtable bind 失敗時不會公布新的 current wrapper，但 drawable 分支隱藏的 State Tracker 失敗不在這項保證內

## Mesa OpenGL frontend

`glxgears` 已經取得 current context，現在要準備齒輪的幾何資料、顏色、rendering target 與每一幀會更新的 state。 從 application 看來，OpenGL 只提供整數名稱、target 與 create／bind／delete 等操作。 Mesa frontend 必須將這些呼叫組成 context state、share-group namespace、object contents 與底層 storage references，後面的 draw 才能找到完整輸入

齒輪主線先讓我們看見 geometry、state 與 rendering target 如何形成一幀。 為了完整理解 Mesa frontend，本章再分別使用 buffer／texture／sampler、shader／program、VAO／framebuffer，以及 query／sync 作為代表性 API 案例。 這些 object families 共享同一套 context、namespace、binding，以及 reference 與生命週期等問題，以下會依各自的 create、bind、delete 與最終釋放路徑逐一展開

```text
OpenGL API 呼叫
│
↓
執行緒區域的 current gl_context
│
├─ per-context API state 與 bindings
├─ driver handoff table 與 dirty state
└─ referenced gl_shared_state
   │
   ├─ numeric-name namespaces
   └─ shared object references
```

### `gl_context` 與 share group

Application 的 OpenGL 呼叫已經由 TLS 找到 current context，現在必須判斷哪些 state 只屬於這個 context、哪些 object namespace 能跨 context 共用。 讀清楚 `gl_context` 與 `gl_shared_state` 的 reference 關係，後面才能判定 bind、share、delete 與 teardown 各自要更新哪一個 owner

#### Context 保存 API state 與 driver handoff

API 入口已取得 current context，卻還需要找到 draw／read framebuffer、dispatch table、dirty state 與 driver callback 的共同根。 因此要從 State Tracker 的 `st_create_context()` 與 `struct gl_context` 開始，確認保存 OpenGL state 的欄位，以及把工作交給 driver 的 handoff 欄位

[`Mesa: src/mesa/state_tracker/st_context.c:762`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.c#L762-790) 的 `st_create_context()` 配置 `gl_context`，寫入 `ctx->pipe` 與 `ctx->screen`，再交給 `_mesa_initialize_context()` 初始化。 make-current 隨後把它放進執行緒區域 current slot。 API object name lookup 會走各類 object namespace，幾乎所有 per-context API state 則以這個 struct 為根

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:3255](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L3255-3285) 的 `struct gl_context` 起始欄位，用來確認 share-group reference 與 API dispatch 各自保存在哪裡。 `Shared` 指向 share group，`SharedLink` 是 member node，`ReleaseResources` 受 shared mutex 保護。 `API` 記錄 profile，`Dispatch` 保存 Mesa table，`GLApi` 則是 client 呼叫使用的 table：

```c
/**
 * Mesa rendering context.
 *
 * This is the central context data structure for Mesa.  Almost all
 * OpenGL state is contained in this structure.
 * Think of this as a base class from which device drivers will derive
 * sub classes.
 */
struct gl_context
{
   /** State possibly shared with other contexts in the address space */
   struct gl_shared_state *Shared;
   struct list_head SharedLink;

   /** Only accessible while Shared->Mutex is held */
   struct util_dynarray ReleaseResources;

   /** Whether Shared->BufferObjects has already been locked for this context. */
   bool BufferObjectsLocked;
   /** Whether Shared->TexMutex has already been locked for this context. */
   bool TexturesLocked;

   /** \name API function pointer tables */
   /*@{*/
   gl_api API;

   /**
    * Dispatch tables implementing OpenGL functions. GLThread has no effect
    * on this.
    */
   struct gl_dispatch Dispatch;
...
```

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:3293](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L3293-3316) 的 `struct gl_context` dispatch 與 framebuffer 欄位，用來觀察 API 入口、framebuffer ownership 與 driver callback 如何分欄保存。 `GLApi` 在 marshal table 和 `Dispatch.Current` 間選出目前生效的公開入口 table，四個 draw／read pointers 區分 API FBO 與 winsys FBO references，`Driver` 則保存 Mesa core 往下呼叫的 callback table：

```c
...
   /**
    * Dispatch table currently in use for fielding API calls from the client
    * program.  If API calls are being marshalled to another thread, this ==
    * MarshalExec.  Otherwise it == Dispatch.Current.
    */
   struct _glapi_table *GLApi;

   /*@}*/

   struct glthread_state GLThread;

   struct gl_config Visual;
   struct gl_framebuffer *DrawBuffer;	/**< buffer for writing */
   struct gl_framebuffer *ReadBuffer;	/**< buffer for reading */
   struct gl_framebuffer *WinSysDrawBuffer;  /**< set with MakeCurrent */
   struct gl_framebuffer *WinSysReadBuffer;  /**< set with MakeCurrent */

   /**
    * Device driver function pointer table
    */
   struct dd_function_table Driver;

   /** Core/Driver constants */
   struct gl_constants Const;
...
```

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:3552](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L3552-3561) 的 `struct gl_context` dirty-state group。 三個 bitsets 顯示 `NewState` 累積 Mesa core 的 `_NEW_*` bits，`PopAttribState` 記錄 push／pop 範圍內的變動，`NewDriverState` 則依 `DriverFlags` 標出 State Tracker 尚未 materialize 的 atoms：

```c
...
   /* GL_ARB_debug_output/GL_KHR_debug */
   simple_mtx_t DebugMutex;
   struct gl_debug_state *Debug;

   GLenum16 RenderMode;      /**< either GL_RENDER, GL_SELECT, GL_FEEDBACK */
   GLbitfield NewState;      /**< bitwise-or of _NEW_* flags */
   GLbitfield PopAttribState; /**< Updated state since glPushAttrib */
   st_state_bitset NewDriverState;  /**< bitwise-or of flags from DriverFlags */

   struct gl_driver_flags DriverFlags;
...
```

所以一個 setter 通常先改 `gl_context` 內的 canonical state 並設 dirty bit。 draw 前的 state 驗證再依 dirty set 計算 derived state，接著經 `Driver` 或 State Tracker hook 建立實際下層 state。 `gl_context` 同時承載 callback、framebuffer references，以及 API 行為與 driver 消費之間的持久 state

```callgraph
Mesa OpenGL frontend：API setter 到 dirty-state handoff
=================================================
[Mesa: src/mesa/main/enable.c:483] _mesa_set_enable(ctx, cap, state)
  │
  ├─ case GL_ALPHA_TEST
  │    │
  │    ├─ if (!_mesa_is_desktop_gl_compat(ctx) && !_mesa_is_gles1(ctx))
  │    │    └─ goto invalid_enum_error
  │    │       // profile legality 先於 current-value short circuit 檢查
  │    ├─ if (ctx->Color.AlphaEnabled == state)
  │    │    └─ return
  │    │       // 合法 profile 上 authoritative state 未變，不新增 dirty bit
  │    ├─ [Mesa: src/mesa/main/context.h:172] FLUSH_VERTICES(...)
  │    │    ctx->NewState |= _NEW_COLOR | _NEW_FF_FRAG_PROGRAM;
  │    │    // core derived values 將在下一個 consumption point 重算
  │    ├─ ctx->NewDriverState |= ctx->DriverFlags.NewAlphaTest;
  │    └─ ctx->Color.AlphaEnabled = state;
  │
  └─ default
       └─ _mesa_error(ctx, GL_INVALID_ENUM, ...); return
          // invalid capability 不跨過 mutation 邊界
  ↓
[Mesa: src/mesa/main/state.c:542] _mesa_update_state_locked(ctx)
  │
  ├─ if (!(ctx->NewState & checked_states))
  │    └─ goto out
  └─ st_invalidate_state(ctx); ctx->NewState = 0;
       // 結果：core state 一致，NewDriverState 仍保存待跑 atoms
```

#### Shared state 保存跨 context 的 object namespace

第二個 context 要與既有 context 分享 texture、buffer 或 program 時，Mesa 會共用 object 查表，per-context binding 仍留在各自的 `gl_context`。 `gl_shared_state` 的 namespace、mutex 與 refcount 劃出這條界線，也決定第一個 context 銷毀後哪些 object 仍由另一個 context 保持存活

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2404](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2404-2423) 的 `struct gl_shared_state` ownership 欄位，用來確認 share group 的互斥、生命週期與成員的 ownership 關係。 `Mutex` 保護 group-wide mutations，`RefCount` 控制整個 container 的生命週期，`Contexts` 走訪 member contexts，`ReleaseResources` 則收納仍被其中某個 context 使用的 resources：

```c
/**
 * State which can be shared by multiple contexts:
 */
struct gl_shared_state
{
   simple_mtx_t Mutex;		   /**< for thread safety */
   GLint RefCount;			   /**< Reference count */
   bool DisplayListsAffectGLThread;

   struct list_head Contexts;   /**< gl_context objects */
   struct set ReleaseResources; /**< in use by some context */

   struct _mesa_HashTable DisplayList;	   /**< Display lists hash table */
   struct _mesa_HashTable TexObjects;	   /**< Texture objects hash table */

   /** Default texture objects (shared by all texture units) */
   struct gl_texture_object *DefaultTex[NUM_TEXTURE_TARGETS];

   /** Fallback texture used when a bound texture is incomplete */
   struct gl_texture_object *FallbackTex[NUM_TEXTURE_TARGETS][2]; /**< [color, depth] */
...
```

其他可分享 object class 也各有 namespace。 `Programs`、`BufferObjects`、`ShaderObjects` 與 `SamplerObjects` 各自保存特定型態。 shader 與 shader program 共用 `ShaderObjects`，其餘名稱則在各自 table 內解讀

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2436](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2436-2475) 的 `struct gl_shared_state` namespace 欄位。 欄位顯示 `Programs`、`BufferObjects`、`ShaderObjects` 與 `SamplerObjects` 各自把 API name 映射到特定 object class，default program pointers 與 zombie buffer set 也由 share group 持有：

```c
...
   /**
    * \name Vertex/geometry/fragment programs
    */
   /*@{*/
   struct _mesa_HashTable Programs; /**< All vertex/fragment programs */
   struct gl_program *DefaultVertexProgram;
   struct gl_program *DefaultFragmentProgram;
   /*@}*/

   /* GL_ATI_fragment_shader */
   struct _mesa_HashTable ATIShaders;
   struct ati_fragment_shader *DefaultFragmentShader;

   struct _mesa_HashTable BufferObjects;
...
   /** Table of both gl_shader and gl_shader_program objects */
   struct _mesa_HashTable ShaderObjects;

   /* GL_EXT_framebuffer_object */
   struct _mesa_HashTable RenderBuffers;
   struct _mesa_HashTable FrameBuffers;

   /* GL_ARB_sync */
   struct set *SyncObjects;

   /** GL_ARB_sampler_objects */
   struct _mesa_HashTable SamplerObjects;
...
```

共享 namespace 不等於共享 binding。 例如兩個 context 都能用同一個 buffer name 查到同一個 buffer object，但各自的 target binding 仍保存在自己的 `gl_context`。 同理，texture object 可以跨 context 看見，texture unit 當下綁哪一個 object 卻是 per-context state。 object storage 由 object references 決定生命週期，binding state 則由持有它的 context 決定

以下程式碼來自 [Mesa: src/mesa/main/shared.c:66](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shared.c#L66-100) 的 `_mesa_alloc_shared_state()`。 配置流程顯示失敗立即回傳 null。 成功後先初始化 mutex、hash tables、context list 與釋放 set，再透過 `ctx->Driver.NewProgram()` 建立 group-owned default programs：

```c
struct gl_shared_state *
_mesa_alloc_shared_state(struct gl_context *ctx,
                         const struct st_config_options *options)
{
   struct gl_shared_state *shared;
   GLuint i;

   shared = CALLOC_STRUCT(gl_shared_state);
   if (!shared)
      return NULL;

   simple_mtx_init(&shared->Mutex, mtx_plain);

   _mesa_InitHashTable(&shared->DisplayList);
   _mesa_InitHashTable(&shared->TexObjects);
   _mesa_InitHashTable(&shared->Programs);
   list_inithead(&shared->Contexts);
   _mesa_set_init(&shared->ReleaseResources, NULL, _mesa_hash_pointer, _mesa_key_pointer_equal);
...
   _mesa_InitHashTable(&shared->ATIShaders);
   shared->DefaultFragmentShader = _mesa_new_ati_fragment_shader(ctx, 0);

   _mesa_InitHashTable(&shared->ShaderObjects);

   _mesa_InitHashTable(&shared->BufferObjects);
   shared->ZombieBufferObjects = _mesa_set_create(NULL, _mesa_hash_pointer,
                                                  _mesa_key_pointer_equal);

   /* GL_ARB_sampler_objects */
   _mesa_InitHashTable(&shared->SamplerObjects);
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/shared.c:437](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shared.c#L437-469) 的 `_mesa_reference_shared_state()`。 reference 變化顯示 same-pointer assignment 是 no-op。 換掉舊 group 時在 mutex 內遞減 `RefCount` 並於零時呼叫 `free_shared_state()`，接上新 group 則先增加 count，再將 `state` 公布到 `*ptr`：

```c
void
_mesa_reference_shared_state(struct gl_context *ctx,
                             struct gl_shared_state **ptr,
                             struct gl_shared_state *state)
{
   if (*ptr == state)
      return;

   if (*ptr) {
      /* unref old state */
      struct gl_shared_state *old = *ptr;
      GLboolean delete;

      simple_mtx_lock(&old->Mutex);
      assert(old->RefCount >= 1);
      old->RefCount--;
      delete = (old->RefCount == 0);
      simple_mtx_unlock(&old->Mutex);

      if (delete) {
         free_shared_state(ctx, old);
      }

      *ptr = NULL;
   }

   if (state) {
      /* reference new state */
      simple_mtx_lock(&state->Mutex);
      state->RefCount++;
      *ptr = state;
      simple_mtx_unlock(&state->Mutex);
   }
}
```

`free_shared_state` 才逐一釋放 default objects、hashes 與仍由 group 擁有的 resources。 因此 group refcount 保護的是整套 namespaces 與它們的 group-owned references，每個 object 仍有獨立 refcount。 兩層 reference 不可混成同一個 count

#### 建立與分享

GLX／DRI 建立新 context 時只會選擇「建立新 share group」或「引用既有 group」，後續初始化仍可能失敗。 需要追 `_mesa_initialize_context()` 的 `share_list` 分支與失敗 unwind，才能確認 group reference 何時取得、何時加入成員串列，以及失敗時由誰釋放

以下程式碼來自 [Mesa: src/mesa/main/context.c:956](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L956-990) 的 `_mesa_initialize_context()` 起點，用來確認 API profile 拒絕分支與成功後的初始欄位。 `switch (api)` 先拒絕建置未支援的 OpenGL／OpenGL ES profile，成功才寫入 `ctx->API`，並把 API 與 winsys draw／read framebuffer pointers 初始化為 null：

```c
GLboolean
_mesa_initialize_context(struct gl_context *ctx,
                         gl_api api,
                         bool no_error,
                         const struct gl_config *visual,
                         struct gl_context *share_list,
                         const struct dd_function_table *driverFunctions,
                         const struct st_config_options *options)
{
   struct gl_shared_state *shared;
   int i;

   switch (api) {
   case API_OPENGL_COMPAT:
   case API_OPENGL_CORE:
      if (!HAVE_OPENGL)
         return GL_FALSE;
      break;
   case API_OPENGLES2:
...
   }
   ...
}
```

`switch (api)` 先決定這個 context 能否使用要求的 profile。 不支援時直接回傳 `GL_FALSE`，所以 `ctx->API`、driver table 與 shared-state ownership 都尚未建立。 確認 profile 可用後，函式才繼續初始化 per-context 欄位

真正的分岔發生在 driver table 安裝之後。 這個順序很重要，因為配置新 shared state 時建立 default texture 與 default program 會呼叫 driver constructors

以下程式碼來自 [Mesa: src/mesa/main/context.c:1006](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1006-1027) 的 `_mesa_initialize_context()` share-group 分支。 執行順序顯示 `ctx->Driver` 必須在 default objects 建立前完成 assignment。 有 `share_list` 時沿用其 `Shared` pointer，否則配置新 group，最後由 `_mesa_reference_shared_state()` 取得正式 ownership：

```c
GLboolean
_mesa_initialize_context(struct gl_context *ctx,
                         gl_api api,
                         bool no_error,
                         const struct gl_config *visual,
                         struct gl_context *share_list,
                         const struct dd_function_table *driverFunctions,
                         const struct st_config_options *options)
{
...
   /* Plug in driver functions and context pointer here.
    * This is important because when we call alloc_shared_state() below
    * we'll call ctx->Driver.NewTextureObject() to create the default
    * textures.
    */
   ctx->Driver = *driverFunctions;

   if (share_list) {
      /* share state with another context */
      shared = share_list->Shared;
   }
   else {
      /* allocate new, unshared state */
      shared = _mesa_alloc_shared_state(ctx, options);
      if (!shared)
         return GL_FALSE;
   }

   /* all supported by default */
   ctx->Const.DriverSupportedPrimMask = 0xffffffff;

   _mesa_reference_shared_state(ctx, &ctx->Shared, shared);
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/context.c:1063](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1063-1075) 的 `_mesa_initialize_context()` 成功提交與失敗收尾。 完整初始化後，函式才在 `Shared->Mutex` 內加入 `SharedLink` 並回傳 `GL_TRUE`。 `fail` label 則放掉先前取得的 shared-state reference，再回傳 `GL_FALSE`：

```c
GLboolean
_mesa_initialize_context(struct gl_context *ctx,
                         gl_api api,
                         bool no_error,
                         const struct gl_config *visual,
                         struct gl_context *share_list,
                         const struct dd_function_table *driverFunctions,
                         const struct st_config_options *options)
{
...
   ctx->FirstTimeCurrent = GL_TRUE;

   simple_mtx_lock(&ctx->Shared->Mutex);
   list_addtail(&ctx->SharedLink, &ctx->Shared->Contexts);
   simple_mtx_unlock(&ctx->Shared->Mutex);
   ctx->ReleaseResources = UTIL_DYNARRAY_INIT;

   return GL_TRUE;

fail:
   _mesa_reference_shared_state(ctx, &ctx->Shared, NULL);
   return GL_FALSE;
}
```

以下程式碼來自 [Mesa: src/mesa/main/context.c:1154](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1154-1166) 的 `_mesa_free_context_data()` shared-state teardown。 Teardown 次序可觀察函式在 group mutex 內移除 `SharedLink`、清空釋放 buffers 並結束 dynarray，解鎖後才以 `_mesa_reference_shared_state(..., NULL)` 放掉 container ownership：

```c
void
_mesa_free_context_data(struct gl_context *ctx, bool destroy_debug_output)
{
...
   /* Shared context state (display lists, textures, etc) */
   simple_mtx_lock(&ctx->Shared->Mutex);
   list_del(&ctx->SharedLink);

   _mesa_clear_releasebufs(ctx);
   util_dynarray_fini(&ctx->ReleaseResources);

   simple_mtx_unlock(&ctx->Shared->Mutex);

   _mesa_reference_shared_state(ctx, &ctx->Shared, NULL);

   if (destroy_debug_output)
      _mesa_destroy_debug_output(ctx);
...
}
```

`list_del(&ctx->SharedLink)` 在 `Shared->Mutex` 保護下先移除 group membership，`_mesa_reference_shared_state(..., NULL)` 則在解鎖後才放掉 context 持有的 group reference。 `SharedLink` 與 `Shared` pointer 因此是兩份不同責任：前者維護 member list，後者控制整套 shared namespaces 的生命週期

```callgraph
Mesa OpenGL frontend：建立 context 與 share group
=================================================
[Mesa: src/mesa/main/context.c:956] _mesa_initialize_context(..., share_list, ...)
  │
  ├─ switch (api) 不受目前建置支援
  │    └─ return GL_FALSE
  │       // 尚未取得 shared-state ownership
  │
  ├─ ctx->Driver = *driverFunctions;
  │    // default shared objects 的 constructors 需要先看到 driver table
  │
  ├─ if (share_list)
  │    └─ shared = share_list->Shared;
  └─ else
       ├─ shared = _mesa_alloc_shared_state(ctx, options);
       └─ if (!shared) return GL_FALSE;
  ↓
[Mesa: src/mesa/main/shared.c:437] _mesa_reference_shared_state(ctx, &ctx->Shared, shared)
  │
  │  state->RefCount++; *ptr = state;
  │  // 新 context 正式持有整套 shared namespaces
  ↓
[Mesa: src/mesa/main/context.c:1029] init_attrib_groups(ctx)
  │
  ├─ 失敗
  │    └─ _mesa_reference_shared_state(ctx, &ctx->Shared, NULL);
  │       return GL_FALSE;
  └─ 成功
       ├─ list_addtail(&ctx->SharedLink, &ctx->Shared->Contexts);
       └─ return GL_TRUE
          // 結果：完整 context 才成為 share-group member
```

這使「sharing」有精確邊界。 context A 與 B 共用 name lookup 與同一 object storage，但不共用目前 target binding、texture unit selection、dirty bits 或 dispatch。 A 的 binding 可以延長 object 生命，卻不會把 B 的 binding slot 改成相同值。 最後一個 context 離開時，shared-state refcount 才歸零並清理整套 namespace

### Buffer、texture 與 sampler

Context 與 share group 已就位後，application 會建立數值名稱、綁定 object，最後再刪除名稱。 這三類 object 的 namespace、binding slot 與 storage owner 並不相同。 逐一讀 create、bind、reference 與 delete 分支，才能判斷名稱何時可重用，以及底層 resource 何時真的釋放

#### Buffer name、binding 與最後一個 reference

Application 依序呼叫 create／gen、bind 與 delete buffer 時，同一個整數名稱可能先對應 dummy、再對應真 object，刪名後 storage 仍可能被 binding 引用。 需要追 `BufferObjects`、binding slot 與 `gl_buffer_object` refcount，才能判定名稱生命週期和 `pipe_resource` 生命週期的分界

`GLuint` name 是 `Shared` 的 `BufferObjects` hash key，target binding 是某個 `gl_context` 內保存 object pointer 的 slot，`gl_buffer_object` 才擁有大小、mapping state 與下層 `pipe_resource` reference。 三者可以在不同時點開始或結束

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:1407](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L1407-1470) 的 `struct gl_buffer_object`。 `Name` 只是 namespace key，`RefCount` 與 `CtxRefCount` 分別追蹤 atomic／owner-context references，`DeletePending` 記錄 API deletion，`buffer`、`Size`、`Usage` 與 mapping records 才描述實際 storage：

```c
/**
 * GL_ARB_vertex/pixel_buffer_object buffer object
 */
struct gl_buffer_object
{
   GLint RefCount;
   GLuint Name;
...
   struct gl_context *Ctx;
   GLint CtxRefCount;   /**< Non-atomic references held by Ctx. */

   gl_buffer_usage UsageHistory; /**< How has this buffer been used so far? */

   struct pipe_resource *buffer;

   GLbitfield StorageFlags; /**< GL_MAP_PERSISTENT_BIT, etc. */
...
   bool DeletePending:1;  /**< true if buffer object is removed from the hash */
   bool Immutable:1;    /**< GL_ARB_buffer_storage */
   bool HandleAllocated:1; /**< GL_ARB_bindless_texture */
   bool GLThreadInternal:1; /**< Created by glthread. */
   GLenum16 Usage;      /**< GL_STREAM_DRAW_ARB, GL_STREAM_READ_ARB, etc. */
   GLchar *Label;       /**< GL_KHR_debug */
   GLsizeiptrARB Size;  /**< Size of buffer storage in bytes */
...
   struct gl_buffer_mapping Mappings[MAP_COUNT];
   struct pipe_transfer *transfer[MAP_COUNT];
};
```

以下程式碼來自 [Mesa: src/mesa/main/bufferobj.c:1937](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L1937-1987) 的 `create_buffers()`。 建立流程顯示 shared hash 先找出 free keys。 DSA 路徑為每個 key 建立真正的 `gl_buffer_object`，Gen 路徑則插入 `DummyBufferObject`

DSA loop 中途配置失敗時，函式記錄 `GL_OUT_OF_MEMORY`、解鎖並直接回傳。 先前迭代已插入的 objects 不會 rollback。 失敗位置與後續的 output names 沒有 object 被插入，函式也沒有清理分支：

```c
static void
create_buffers(struct gl_context *ctx, GLsizei n, GLuint *buffers, bool dsa)
{
...
   _mesa_HashFindFreeKeys(&ctx->Shared->BufferObjects, buffers, n);
...
   for (int i = 0; i < n; i++) {
      if (dsa) {
         buf = new_gl_buffer_object(ctx, buffers[i]);
         if (!buf) {
            _mesa_error(ctx, GL_OUT_OF_MEMORY, "glCreateBuffers");
            _mesa_HashUnlockMaybeLocked(&ctx->Shared->BufferObjects,
                                        ctx->BufferObjectsLocked);
            return;
         }
      }
      else
         buf = &DummyBufferObject;

      _mesa_HashInsertLocked(&ctx->Shared->BufferObjects, buffers[i], buf);
   }
...
}
```

hash value 的型態是 object pointer，但 key 仍只是 name。 `DummyBufferObject` 更直接證明兩者不能畫上等號

後半段依 `dsa` 選擇真正 object 或 dummy，再把 name 與 value 成對插入。 [Mesa: src/mesa/main/bufferobj.c:1963](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L1963-1983) 顯示初始 name-to-value entry

以下程式碼來自 [Mesa: src/mesa/main/bufferobj.c:1321](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L1321-1358) 的 `bind_buffer_object()`。 Binding 路徑可追蹤 `buffer == 0` 如何選擇 null binding，非零 name 如何從 `Shared->BufferObjects` 在 dummy entry 上 lazy-create object。 最後由 reference helper 同時放掉 `oldBufObj` 並讓 `bindTarget` 取得新 ownership：

```c
/**
 * Bind the specified target to buffer for the specified context.
 * Called by glBindBuffer() and other functions.
 */
static void
bind_buffer_object(struct gl_context *ctx,
                   struct gl_buffer_object **bindTarget, GLuint buffer,
                   bool no_error)
{
   struct gl_buffer_object *oldBufObj;
   struct gl_buffer_object *newBufObj;

   assert(bindTarget);

   /* Fast path that unbinds. It's better when NULL is a literal, so that
    * the compiler can simplify this code after inlining.
    */
   if (buffer == 0) {
      _mesa_reference_buffer_object(ctx, bindTarget, NULL);
      return;
   }
...
   newBufObj = _mesa_lookup_bufferobj(ctx, buffer);
   /* Get a new buffer object if it hasn't been created. */
   if (unlikely(!handle_bind_buffer_gen(ctx, buffer, &newBufObj, "glBindBuffer",
                                        no_error)))
      return;

   /* At this point, the compiler should deduce that newBufObj is non-NULL if
    * everything has been inlined, so the compiler should simplify this.
    */
   _mesa_reference_buffer_object(ctx, bindTarget, newBufObj);
}
```

`buffer == 0` 把 slot 換成 `NULL`。 非零時，reference helper 先 drop slot 的舊 object，再取得新 object。 因此 target binding 本身就是 storage 生命週期的一個 owner。 share group 內另一個 context 的 binding slot 可以指向相同 object，但兩個 slot 的選擇彼此獨立

buffer 有一項特別的 reference optimization。 建立它的 context 以 `Ctx` 與 `CtxRefCount` 統計私有 bind points，並以一個 global reference 涵蓋它們。 其他 context 與嵌在共享 object 內的 binding 仍使用 atomic `RefCount`

以下程式碼來自 [Mesa: src/mesa/main/bufferobj.h:140](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.h#L140-179) 的 `_mesa_reference_buffer_object_()`。 Helper 顯示 `shared_binding` 如何選擇 global atomic `RefCount` 或 owner-context `CtxRefCount` fast 路徑。 只有 global `RefCount` 減至零的分支會呼叫 `_mesa_delete_buffer_object()`，之後再增加新 object 的對應 reference 並更新 `*ptr`：

```c
static inline void
_mesa_reference_buffer_object_(struct gl_context *ctx,
                               struct gl_buffer_object **ptr,
                               struct gl_buffer_object *bufObj,
                               bool shared_binding)
{
   if (*ptr) {
      /* Unreference the old buffer */
      struct gl_buffer_object *oldObj = *ptr;
...
      if (shared_binding || ctx != oldObj->Ctx) {
         if (p_atomic_dec_zero(&oldObj->RefCount)) {
            _mesa_delete_buffer_object(ctx, oldObj);
         }
      } else {
...
         oldObj->CtxRefCount--;
...
      }
   }
...
   if (bufObj) {
      /* reference new buffer */
      if (shared_binding || ctx != bufObj->Ctx) {
         p_atomic_inc(&bufObj->RefCount);
      } else {
         bufObj->CtxRefCount++;
...
      }
   }
...
   *ptr = bufObj;
}
```

`shared_binding` 與 `ctx == oldObj->Ctx` 共同決定舊 reference 要扣 global atomic `RefCount` 還是 owner 私有 `CtxRefCount`。 這個 helper 只在 `RefCount` 減至零時呼叫 `_mesa_delete_buffer_object()`，`CtxRefCount` 分支僅遞減私有 count。 新 object 以同一條件增加對應計數，`*ptr` 最後才改指 `bufObj`，因此 binding slot 在替換完成後才持有新的 ownership

delete 先處理 current context 的 mappings 與相關 bindings，再讓 name 失效。 其他分享 context 可能仍持有 pointer，所以 object 不一定能一起消失。 [Mesa: src/mesa/main/bufferobj.c:1754](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L1754-1779) 顯示 lookup 是經 shared hash，並且在改變 bindings 前先解除 mappings

最後階段先從 `BufferObjects` 移除 key，所以數值 ID 可立即重用。 `DeletePending` 防止同一 share group 裡的另一個 context 經舊 pointer 把已刪 object 當成新 name 的 object

以下程式碼來自 [Mesa: src/mesa/main/bufferobj.c:1880](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L1880-1907) 的 `delete_buffers()` tail。 刪除順序顯示 hash key 先移除以便立即重用 ID，object 同時設為 `DeletePending`。 若呼叫端是 fast-path owner 就先 `detach_ctx_from_buffer()`，最後才放掉 namespace reference，讓其他 bindings 決定 storage 的最終釋放：

```c
static void
delete_buffers(struct gl_context *ctx, GLsizei n, const GLuint *ids)
{
...
         /* The ID is immediately freed for re-use */
         _mesa_HashRemoveLocked(&ctx->Shared->BufferObjects, ids[i]);
...
         bufObj->DeletePending = GL_TRUE;
...
         assert(p_atomic_read(&bufObj->RefCount) >= (bufObj->Ctx ? 2 : 1));
...
         if (bufObj->Ctx == ctx) {
            detach_ctx_from_buffer(ctx, bufObj);
         } else if (bufObj->Ctx) {
            /* Only the context holding it can release it. */
            _mesa_set_add(ctx->Shared->ZombieBufferObjects, bufObj);
         }
...
         _mesa_reference_buffer_object(ctx, &bufObj, NULL);
...
}
```

Buffer storage 在最後一個 reference 消失時釋放。 Name 可以先被重用，舊 binding 仍指向原本 object。 新 object 只是取得同一個整數 name。 Namespace reference、建立者 global reference、所有 bindings 與共享 attachment references 都消失後，`_mesa_delete_buffer_object` 才釋放舊 `pipe_resource`

```callgraph
Mesa OpenGL frontend：buffer 與 texture 的獨立生命週期事件
=================================================
Application API events
  │
  ├─ CreateBuffers／GenBuffers event
  │    ↓
  │  [Mesa: src/mesa/main/bufferobj.c:1943] create_buffers(ctx, n, names, dsa)
  │    ├─ if (dsa)
  │    │    ├─ buf = new_gl_buffer_object(ctx, names[i])
  │    │    └─ if (!buf) GL_OUT_OF_MEMORY; return
  │    ├─ else：buf = &DummyBufferObject
  │    └─ _mesa_HashInsertLocked(..., names[i], buf)
  │         // CreateBuffers 與 GenBuffers 都把 name 插入 shared namespace
  │
  ├─ BindBuffer event
  │    ↓
  │  [Mesa: src/mesa/main/bufferobj.c:1326] bind_buffer_object(ctx, bindTarget, name, ...)
  │    ├─ if (name == 0)：_mesa_reference_buffer_object(..., NULL); return
  │    └─ lookup／lazy-create 成功：reference binding slot 到 `newBufObj`
  │         // binding slot 持有 object reference，數值 name 只負責 lookup
  │
  ├─ DeleteBuffers event
  │    ↓
  │  [Mesa: src/mesa/main/bufferobj.c:1761] delete_buffers(ctx, n, names)
  │    ├─ _mesa_HashRemoveLocked(...); bufObj->DeletePending = GL_TRUE
  │    ├─ bufObj->Ctx == ctx：detach_ctx_from_buffer(ctx, bufObj)
  │    │    // 將私有 CtxRefCount 轉回 global RefCount，再放掉 creator reference
  │    ├─ bufObj->Ctx 屬於其他 context：加入 ZombieBufferObjects
  │    └─ _mesa_reference_buffer_object(ctx, &bufObj, NULL)
  │         ↓
  │       [Mesa: src/mesa/main/bufferobj.h:141] _mesa_reference_buffer_object_(ctx, ptr, bufObj, shared)
  │         ├─ 私有 owner binding：oldObj->CtxRefCount--
  │         └─ shared／non-owner binding：p_atomic_dec_zero(&oldObj->RefCount)
  │              ├─ false：object 由其餘 binding／attachment reference 保留
  │              └─ true
  │                   ↓
  │                 [Mesa: src/mesa/main/bufferobj.c:1025] _mesa_delete_buffer_object(ctx, oldObj)
  │                   ├─ _mesa_buffer_unmap_all_mappings(ctx, oldObj)
  │                   ├─ _mesa_bufferobj_release_buffer(ctx, oldObj)
  │                   └─ free(oldObj)
  │                        // 最終結果：最後一個 reference 歸零後才釋放 pipe resource 與 object
  │
  ├─ CreateTextures／GenTextures event
  │    ↓
  │  [Mesa: src/mesa/main/texobj.c:1215] create_textures(ctx, target, n, textures, caller)
  │    ├─ texObj = _mesa_new_texture_object(ctx, textures[i], target)
  │    ├─ texObj == NULL：GL_OUT_OF_MEMORY; unlock; return
  │    └─ _mesa_HashInsertLocked(&ctx->Shared->TexObjects,
  │                              texObj->Name, texObj)
  │         // shared namespace 由數值 name 對應到 gl_texture_object
  │
  ├─ BindTexture event
  │    ↓
  │  [Mesa: src/mesa/main/texobj.c:1759] bind_texture(ctx, target, texName, texunit, no_error, caller)
  │    ├─ 依 target 與 texName lookup／lazy-create object
  │    └─ [Mesa: src/mesa/main/texobj.c:1607] bind_texture_object(ctx, unit, texObj)
  │         └─ _mesa_reference_texobj(&texUnit->CurrentTex[targetIndex], texObj)
  │              // texture unit 的 binding slot 持有 object reference，不保存 storage handle
  │
  └─ DeleteTextures event
       ↓
     [Mesa: src/mesa/main/texobj.c:1464] delete_textures(ctx, n, textures)
       ├─ unbind_texobj_from_fbo(ctx, delObj)
       ├─ unbind_texobj_from_texunits(ctx, delObj)
       ├─ unbind_texobj_from_image_units(ctx, delObj)
       ├─ _mesa_make_texture_handles_non_resident(ctx, delObj)
       ├─ delObj->DeletePending = true
       ├─ _mesa_HashRemove(&ctx->Shared->TexObjects, delObj->Name)
       │    // name 立即離開 namespace。 其他 context／attachment reference 仍可保存 object
       └─ [Mesa: src/mesa/main/texobj.c:610] _mesa_reference_texobj_(&delObj, NULL)
            ├─ old refcount 仍非零：只替換 pointer，object 繼續存活
            └─ p_atomic_dec_zero(&oldTex->RefCount)
                 ↓
               [Mesa: src/mesa/main/texobj.c:513] _mesa_delete_texture_object(ctx, oldTex)
                 ├─ pipe_resource_reference(&oldTex->pt, NULL)
                 ├─ 刪除 face／level images、sampler views 與 bindless handles
                 └─ FREE(oldTex)
                      // 最終結果：最後一個 reference 消失後才釋放 texture storage 與 object
```

#### Texture object 與 texture unit binding

Application 綁定 texture 時，同一個 name 還要經過 active unit 與 target 兩層選擇，delete 又可能只讓 name 失效而保留 image storage。 讀 `CurrentTex`、`TargetIndex`、`TexObjects` 與 texture reference helper，才能知道 shader 取樣時實際持有哪個 object，以及最後誰釋放 `pt`

texture 同樣分成 shared name、per-context binding 與 object storage，但 binding 是二維選擇。 先由 active texture unit 選 unit，再由 texture target 選 `CurrentTex` index。 object 的 `TargetIndex` 把 target 對應到這個 index，name 仍只用於 `Shared` 的 `TexObjects` lookup

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:911](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L911-938) 的 `struct gl_texture_object`，用來確認 texture identity、生命週期與 storage reference 分別落在哪些欄位。 `Name`／`Target` 定義 API identity，`RefCount` 與 `DeletePending` 控制生命週期，`Image[face][level]` 保存 frontend images，`pt` 與 `BufferObject` references 則連到 Gallium texture 或 texture-buffer storage：

```c
/**
 * Texture object state.  Contains the array of mipmap images, border color,
 * wrap modes, filter modes, and shadow/texcompare state.
 */
struct gl_texture_object
{
   GLint RefCount;             /**< reference count */
   GLuint Name;                /**< the user-visible texture object ID */
   GLenum16 Target;            /**< GL_TEXTURE_1D, GL_TEXTURE_2D, etc. */
   GLchar *Label;              /**< GL_KHR_debug */

   struct gl_sampler_object Sampler;
   struct gl_texture_object_attrib Attrib;  /**< State saved by glPushAttrib */

   gl_texture_index TargetIndex; /**< The gl_texture_unit::CurrentTex index.
                                      Only valid when Target is valid. */
   GLbyte _MaxLevel;           /**< actual max mipmap level (q in the spec) */
   GLfloat _MaxLambda;         /**< = _MaxLevel - BaseLevel (q - p in spec) */
   GLint CropRect[4];          /**< GL_OES_draw_texture */
   GLboolean _BaseComplete;    /**< Is the base texture level valid? */
   GLboolean _MipmapComplete;  /**< Is the whole mipmap valid? */
   GLboolean _IsIntegerFormat; /**< Does the texture store integer values? */
   GLboolean _RenderToTexture; /**< Any rendering to this texture? */
   GLboolean Immutable;        /**< GL_ARB_texture_storage */
   GLboolean _IsFloat;         /**< GL_OES_float_texture */
   GLboolean _IsHalfFloat;     /**< GL_OES_half_float_texture */
   bool HandleAllocated;       /**< GL_ARB_bindless_texture */
   bool DeletePending;         /**< true if texture object is removed from the hash */
...
```

真正影像內容不在 name 或 texture unit。 `Image[face][level]` 保存 frontend image objects，`pt` 保存已驗證的下層 texture resource。 texture buffer mode 還會持有一個 buffer object reference

[Mesa: src/mesa/main/mtypes.h:952](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L952-994) 顯示 storage owners

以下程式碼來自 [Mesa: src/mesa/main/texobj.c:1207](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/texobj.c#L1207-1245) 的 `create_textures()`。 Loop 顯示 free name 和 requested target 如何傳給 `_mesa_new_texture_object()`，配置失敗解鎖 shared texture hash 並回報 `GL_OUT_OF_MEMORY`，成功 object 才以 name 作 key 插入 `TexObjects`：

```c
static void
create_textures(struct gl_context *ctx, GLenum target, GLsizei n,
                GLuint *textures, const char *caller)
{
...
   /* Allocate new, empty texture objects */
   for (i = 0; i < n; i++) {
      struct gl_texture_object *texObj;
      texObj = _mesa_new_texture_object(ctx, textures[i], target);
      if (!texObj) {
         _mesa_HashUnlockMutex(&ctx->Shared->TexObjects);
         _mesa_error(ctx, GL_OUT_OF_MEMORY, "%s", caller);
         return;
      }

      /* insert into hash table */
      _mesa_HashInsertLocked(&ctx->Shared->TexObjects, texObj->Name, texObj);
   }

   _mesa_HashUnlockMutex(&ctx->Shared->TexObjects);
}
```

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:1224](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L1224-1243) 的 `struct gl_texture_unit`。 欄位顯示 `_BoundTextures` 只摘要哪些 targets 使用 non-default object，`CurrentTex[]` 持有各 target 的 texture references，單一 `Sampler` pointer 則獨立選擇 named sampler state：

```c
/**
 * Sampler-related subset of a texture unit, like current texture objects.
 */
struct gl_texture_unit
{
   GLfloat LodBias;		/**< for biasing mipmap levels */
   float LodBiasQuantized;      /**< to reduce pipe_sampler_state variants */

   /** Texture targets that have a non-default texture bound */
   GLbitfield _BoundTextures;

   /** Current sampler object (GL_ARB_sampler_objects) */
   struct gl_sampler_object *Sampler;

   /** Current texture object pointers */
   struct gl_texture_object *CurrentTex[NUM_TEXTURE_TARGETS];

   /** Points to highest priority, complete and enabled texture object */
   struct gl_texture_object *_Current;
};
```

bind 先依 target 與 name lookup 或建立 object，再更新指定 unit。 [Mesa: src/mesa/main/texobj.c:1750](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/texobj.c#L1750-1769) 沒有把 name 留在 unit，而是把查到的 pointer 傳給 `bind_texture_object`

以下程式碼來自 [Mesa: src/mesa/main/texobj.c:1639](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/texobj.c#L1639-1661) 的 `bind_texture_object()`。 Mutation 路徑可觀察函式先以 `_NEW_TEXTURE_OBJECT` flush／mark core state，old／new `glclamp_mask` 不同時再標記 `NewSamplersWithClamp` atoms，最後替換 `CurrentTex[targetIndex]` reference 並更新 `_BoundTextures`：

```c
static void
bind_texture_object(struct gl_context *ctx, unsigned unit,
                    struct gl_texture_object *texObj)
{
...
   FLUSH_VERTICES(ctx, _NEW_TEXTURE_OBJECT, GL_TEXTURE_BIT);

   /* if the previously bound texture uses GL_CLAMP, flag the driver here
    * to ensure any emulation is disabled
    */
   if (texUnit->CurrentTex[targetIndex] &&
       texUnit->CurrentTex[targetIndex]->Sampler.glclamp_mask !=
       texObj->Sampler.glclamp_mask)
      ST_SET_STATES(ctx->NewDriverState, ctx->DriverFlags.NewSamplersWithClamp);

   /* If the refcount on the previously bound texture is decremented to
    * zero, it'll be deleted here.
    */
   _mesa_reference_texobj(&texUnit->CurrentTex[targetIndex], texObj);

   ctx->Texture.NumCurrentTexUsed = MAX2(ctx->Texture.NumCurrentTexUsed,
                                         unit + 1);

   if (texObj->Name != 0)
      texUnit->_BoundTextures |= (1 << targetIndex);
   else
      texUnit->_BoundTextures &= ~(1 << targetIndex);
}
```

texture delete 會解除 current context 內相關 attachment、texture-unit 與 image-unit bindings。 這只處理呼叫端的 binding state，share group 中其他 context 的 references 仍可保留 object

以下程式碼來自 [Mesa: src/mesa/main/texobj.c:1496](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/texobj.c#L1496-1518) 的 `delete_textures()` 清理 tail，用來追蹤 name removal 與 namespace reference 釋放的先後順序。 三個 `unbind_texobj_*()` helper 已解除呼叫端 context 內的 references，片段接著讓 bindless handles non-resident、設定 `DeletePending`、移除 shared hash key，以及放掉 namespace reference。 其他 context 的 references 仍可延後 destructor：

```c
static void
delete_textures(struct gl_context *ctx, GLsizei n, const GLuint *textures)
{
...
            /* Make all handles that reference this texture object non-resident
             * in the current context.
             */
            _mesa_make_texture_handles_non_resident(ctx, delObj);

            delObj->DeletePending = true;

            _mesa_unlock_texture(ctx, delObj);

            ctx->NewState |= _NEW_TEXTURE_OBJECT;
            ctx->PopAttribState |= GL_TEXTURE_BIT;

            /* The texture _name_ is now free for re-use.
             * Remove it from the hash table now.
             */
            _mesa_HashRemove(&ctx->Shared->TexObjects, delObj->Name);

            st_texture_release_all_sampler_views(st_context(ctx), delObj);

            /* Unreference the texobj.  If refcount hits zero, the texture
             * will be deleted.
             */
            _mesa_reference_texobj(&delObj, NULL);
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/texobj.c:610](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/texobj.c#L610-653) 的 `_mesa_reference_texobj_()`。 reference 變化顯示 old texture 的 atomic count 歸零時才進 `_mesa_delete_texture_object()`，新 texture 在 pointer publication 前先增加 count。 同一 helper 因而讓 unit、attachment 與 sharing-context slots 共用一致的 ownership transition：

```c
void
_mesa_reference_texobj_(struct gl_texture_object **ptr,
                        struct gl_texture_object *tex)
{
...
   if (*ptr) {
      /* Unreference the old texture */
      struct gl_texture_object *oldTex = *ptr;
...
      if (p_atomic_dec_zero(&oldTex->RefCount)) {
...
         GET_CURRENT_CONTEXT(ctx);
         if (ctx)
            _mesa_delete_texture_object(ctx, oldTex);
...
      }
   }

   if (tex) {
      /* reference new texture */
      assert(valid_texture_object(tex));
      assert(tex->RefCount > 0);

      p_atomic_inc(&tex->RefCount);
   }
...
   *ptr = tex;
}
```

以下程式碼來自 [Mesa: src/mesa/main/texobj.c:512](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/texobj.c#L512-544) 的 `_mesa_delete_texture_object()` 最終 destructor，用來確認 texture object 的最後一個 reference 釋放哪些子 object，以及 teardown 的先後次序。 `pt`、sampler views、所有 face／level images、bindless handles 與 texture-buffer reference 依序被放掉，label 和 `texObj` 最後才 free，所以 storage 清理只發生在 object refcount 歸零後：

```c
void
_mesa_delete_texture_object(struct gl_context *ctx,
                            struct gl_texture_object *texObj)
{
...
   pipe_resource_reference(&texObj->pt, NULL);
   st_delete_texture_sampler_views(ctx->st, texObj);
   simple_mtx_destroy(&texObj->validate_mutex);
...
   for (face = 0; face < 6; face++) {
      for (i = 0; i < MAX_TEXTURE_LEVELS; i++) {
         if (texObj->Image[face][i]) {
            _mesa_delete_texture_image(ctx, texObj->Image[face][i]);
         }
      }
   }
...
   _mesa_delete_texture_handles(ctx, texObj);
...
   _mesa_reference_buffer_object_shared(ctx, &texObj->BufferObject, NULL);
   free(texObj->Label);
...
   FREE(texObj);
}
```

destructor 依序清掉 `pt`、sampler views、各 face／level 的 image、bindless handles 與 `BufferObject` reference，最後才釋放 `texObj`。 這段沒有處理 texture-unit binding 或 namespace key，表示它執行時那些 owner 已先放掉 reference。 storage teardown 由最後一個 object reference 集中完成

#### Sampler 和 texture storage 分離

Texture unit 已持有 texture storage reference，但 application 還能另外綁定 named sampler。 需要追 `SamplerObjects`、unit 的 `Sampler` pointer 與 name 0 分支，才能判斷取樣參數來自 named object 還是 texture 內嵌 state，也才能區分 sampler delete 和 texture storage teardown

sampler object 保存 filter、wrap、compare 與 LOD 等取樣參數，不保存 mip levels 或 `pipe_resource`。 named sampler 的 namespace 是 `Shared` 的 `SamplerObjects`，binding 則是每個 texture unit 的單一 `Sampler` pointer。 它與同一 unit 的 `CurrentTex[target]` 是兩條獨立 reference

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:879](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L879-898) 的 `struct gl_sampler_object`。 欄位顯示 struct 只有 `Name`、`RefCount`、`DeletePending` 與 `gl_sampler_attrib Attrib` 等 sampler state，沒有 texture images 或 `pipe_resource`，因此 named sampler 可獨立於 texture storage 被建立、綁定與刪除：

```c
/**
 * Sampler object state.  These objects are new with GL_ARB_sampler_objects
 * and OpenGL 3.3.  Legacy texture objects also contain a sampler object.
 */
struct gl_sampler_object
{
   GLuint Name;
   GLchar *Label;               /**< GL_KHR_debug */
   GLint RefCount;

   struct gl_sampler_attrib Attrib;  /**< State saved by glPushAttrib */

   uint8_t glclamp_mask; /**< mask of GL_CLAMP wraps active */

   bool DeletePending; /**< true if sampler object is removed from the hash */

   /** GL_ARB_bindless_texture */
   bool HandleAllocated;
   struct util_dynarray Handles;
};
```

`Name` 是 shared hash 的 key，`RefCount` 與 `DeletePending` 管理 named sampler 的生命週期，`Attrib` 保存 filter、wrap、compare 與 LOD。 結構內沒有 texture image 或 `pipe_resource` 欄位，所以 sampler reference 歸零只回收 sampler state 與 handles，不會釋放 texture storage

建立 sampler 時，Mesa 在 shared sampler hash 內找空 names，為每個 name 配置 object，再插入 key 與 pointer。 [Mesa: src/mesa/main/samplerobj.c:170](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/samplerobj.c#L170-199) 與 buffer、texture 一樣清楚區分 ID 和 value

bind 時，name 0 不 lookup named object，而是將 unit 的 named `Sampler` pointer 設成 `NULL`。 這個 `NULL` 有明確語意，代表改用目前 texture object 內嵌的 legacy sampler state

以下程式碼來自 [Mesa: src/mesa/main/samplerobj.c:322](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/samplerobj.c#L322-343) 的 `bind_sampler()`。 分支顯示 `sampler == 0` 將 unit slot 設為 null，讓 texture object 內嵌 sampler 生效。 非零 name 必須從 `Shared->SamplerObjects` 查到 object，之後 `_mesa_bind_sampler()` 只替換 sampler reference 並標記 texture state dirty：

```c
static ALWAYS_INLINE void
bind_sampler(struct gl_context *ctx, GLuint unit, GLuint sampler, bool no_error)
{
   struct gl_sampler_object *sampObj;

   if (sampler == 0) {
      /* Use the default sampler object, the one contained in the texture
       * object.
       */
      sampObj = NULL;
   } else {
      /* user-defined sampler object */
      sampObj = _mesa_lookup_samplerobj(ctx, sampler);
      if (!no_error && !sampObj) {
         _mesa_error(ctx, GL_INVALID_OPERATION, "glBindSampler(sampler)");
         return;
      }
   }

   /* bind new sampler */
   _mesa_bind_sampler(ctx, unit, sampObj);
}
```

`_mesa_bind_sampler` 透過 reference helper 替換 unit slot，[Mesa: src/mesa/main/samplerobj.c:310](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/samplerobj.c#L310-320) 則顯示它只標示 texture state dirty 並更新 sampler reference。 它沒有移動、複製或重新配置 texture storage

以下程式碼來自 [Mesa: src/mesa/main/samplerobj.c:242](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/samplerobj.c#L242-275) 的 `delete_samplers()`。 Namespace 清理可觀察 valid name 先把 object 標成 `DeletePending` 並從 `SamplerObjects` 移除以釋放 ID，接著只放掉 namespace reference。 仍被任何 texture unit 綁定的 sampler 要等最後一個 `_mesa_reference_sampler_object()` 才刪除：

```c
static void
delete_samplers(struct gl_context *ctx, GLsizei count,
                const GLuint *samplers)
{
...
   for (GLsizei i = 0; i < count; i++) {
      if (samplers[i]) {
         ...
         if (sampObj) {
            ...
            sampObj->DeletePending = true;

            /* The ID is immediately freed for re-use */
            _mesa_HashRemoveLocked(&ctx->Shared->SamplerObjects, samplers[i]);
            /* But the object exists until its reference count goes to zero */
            _mesa_reference_sampler_object(ctx, &sampObj, NULL);
         }
      }
   }
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/samplerobj.c:82](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/samplerobj.c#L82-110) 的 `_mesa_reference_sampler_object_()`，用來確認 unit replacement 如何轉移 sampler reference，以及 refcount 歸零時如何觸發最終刪除：

```c
void
_mesa_reference_sampler_object_(struct gl_context *ctx,
                                struct gl_sampler_object **ptr,
                                struct gl_sampler_object *samp)
{
...
   if (*ptr) {
      /* Unreference the old sampler */
      struct gl_sampler_object *oldSamp = *ptr;

      assert(oldSamp->RefCount > 0);

      if (p_atomic_dec_zero(&oldSamp->RefCount))
         delete_sampler_object(ctx, oldSamp);
   }
...
   if (samp) {
      /* reference new sampler */
      assert(samp->RefCount > 0);

      p_atomic_inc(&samp->RefCount);
   }
...
   *ptr = samp;
}
```

因此 texture 與 sampler 的完整生命週期是正交的。 texture name、unit texture binding、images 與 `pt` 構成 texture storage 路徑。 sampler name、unit sampler binding 與 `Attrib` 構成 sampler state 路徑。 bind 或 delete named sampler 都不會擁有或釋放 texture images，而刪除 texture 也不會因而刪除獨立 named sampler

```text
texture unit
│
├─ CurrentTex target slot
│  │
│  └─ texture object
│     │
│     ├─ image objects
│     └─ pipe texture resource
│
└─ named Sampler slot
   │
   ├─ non-null named sampler attributes
   └─ null selects texture-embedded attributes
```

### Shader、program 與 linked stage

Application 接著把 shader source 編譯並 attach 到 program，再把 link 結果設為目前 executable。 這條路同時存在 shader object、program container 與 per-stage `gl_program`。 讀清它們的 references 與 `DeletePending`，才能知道 relink、use 與 delete 分別作用在哪一層

#### Shader object 保存 source、compile 結果與 NIR

Application 交入 shader source 後，需要由同一個 API object 保存原文、compile status、info log 與產出的 NIR。 先讀 `gl_shader` 和 `create_shader()`，才能把數值 name、可重編譯的 source 與 compile 結果分開，並為後續 attach/link 的 ownership 打底

以下程式碼來自 [Mesa: src/mesa/main/shader_types.h:164](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L164-204) 的 `struct gl_shader`。 欄位顯示 `Name`、`RefCount` 與 `DeletePending` 管理 API object 生命週期，`Source`、`CompileStatus`／`InfoLog` 與 per-shader NIR 欄位則讓同一 object 同時保存輸入文字、compile 結果及編譯後 IR：

```c
struct gl_shader
{
...
   GLenum16 Type;
   mesa_shader_stage Stage;
   GLuint Name;  /**< AKA the handle */
   GLint RefCount;  /**< Reference count */
   GLchar *Label;   /**< GL_KHR_debug */
   GLboolean DeletePending;
...
   enum gl_compile_status CompileStatus;
...
   const GLchar *Source;  /**< Source code string */
   const GLchar *FallbackSource;  /**< Fallback string used by on-disk cache*/

   GLchar *InfoLog;

   unsigned Version;       /**< GLSL version used for linking */
...
   struct nir_shader *nir;
   struct ir_exec_list *ir;
...
```

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:400](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L400-414) 的 `create_shader()`。 建立路徑可追蹤函式在 `Shared->ShaderObjects` mutex 內取得 free name，以 stage 配置 `gl_shader` 並寫入公開 `Type`，最後將 name／pointer pair 插入 shared hash，讓 namespace reference 從建立時開始持有 object：

```c
static GLuint
create_shader(struct gl_context *ctx, GLenum type)
{
   struct gl_shader *sh;
   GLuint name;

   _mesa_HashLockMutex(&ctx->Shared->ShaderObjects);
   name = _mesa_HashFindFreeKeyBlock(&ctx->Shared->ShaderObjects, 1);
   sh = _mesa_new_shader(name, _mesa_shader_enum_to_shader_stage(type));
   sh->Type = type;
   _mesa_HashInsertLocked(&ctx->Shared->ShaderObjects, name, sh);
   _mesa_HashUnlockMutex(&ctx->Shared->ShaderObjects);

   return name;
}
```

compile 更新的是這個 object 的結果欄位。 attach 則只增加對同一 shader object 的 reference，不複製 source 或 NIR。 因此 shader source storage 要等 name owner 與所有 program attachments 都放掉 reference 才能釋放

#### Program object 保存 attached shader 與 linked shader

Attach 與 link 之間必須同時保留輸入 shader 與新產生的 per-stage executable，否則 relink 或查詢 attached shader 會失去依據。 需要讀 `gl_shader_program::Shaders`、`_LinkedShaders[]` 與 `attach_shader()` 的 reference replacement，才能判斷兩組 object 的 owner 和失敗時該保留哪一份

shader program 與 shader 共用 `ShaderObjects` namespace，但 value 的 `Type` 不同，lookup helper 也會驗證 object class。 `gl_shader_program` 的 `Shaders` 陣列保存 attached input objects，`_LinkedShaders[stage]` 保存 link 產生的 per-stage objects

以下程式碼來自 [Mesa: src/mesa/main/shader_types.h:383](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L383-482) 的 `struct gl_shader_program`，用來確認 attached inputs、link 結果與 program container 生命週期的欄位分工。 `Shaders`／`NumShaders` 保存 attached input references，`_LinkedShaders[]` 保存各 stage 的 link 結果，`Name`、`RefCount` 與 `DeletePending` 則控制 program container 在 namespace 與 current bindings 間的生命週期：

```c
struct gl_shader_program
{
   GLenum16 Type;   /**< Always GL_SHADER_PROGRAM (internal token) */
   GLuint Name;  /**< aka handle or ID */
   GLchar *Label;   /**< GL_KHR_debug */
   GLint RefCount;  /**< Reference count */
   GLboolean DeletePending;
...
   GLuint NumShaders;          /**< number of attached shaders */
   struct gl_shader **Shaders; /**< List of attached the shaders */
...
   struct gl_linked_shader *_LinkedShaders[MESA_SHADER_MESH_STAGES];

   unsigned GLSL_Version; /**< GLSL version used for linking */
};
```

program 建立同樣在 `ShaderObjects` 找 name，配置 `gl_shader_program` 並插入 pointer。 [Mesa: src/mesa/main/shaderapi.c:430](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L430-449) 顯示新 object 以 `RefCount == 1` 進入 namespace

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:318](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L318-338) 的 `attach_shader()`。 固定版本把 `realloc()` 結果直接指定回 `shProg->Shaders`

配置失敗時會回報 `GL_OUT_OF_MEMORY`，不增加 `NumShaders`，也不取得新的 shader reference，但 program 欄位已被空值覆寫，原先配置得到的 pointer 因而遺失。 成功後 `_mesa_reference_shader()` 才讓新 slot 取得 shader ownership，再增加 `NumShaders`：

```c
/**
 * Attach shader to a shader program.
 */
static void
attach_shader(struct gl_context *ctx, struct gl_shader_program *shProg,
              struct gl_shader *sh)
{
   GLuint n = shProg->NumShaders;

   shProg->Shaders = realloc(shProg->Shaders,
                             (n + 1) * sizeof(struct gl_shader *));
   if (!shProg->Shaders) {
      _mesa_error(ctx, GL_OUT_OF_MEMORY, "glAttachShader");
      return;
   }

   /* append */
   shProg->Shaders[n] = NULL; /* since realloc() didn't zero the new space */
   _mesa_reference_shader(ctx, &shProg->Shaders[n], sh);
   shProg->NumShaders++;
}
```

detach 或 program teardown 會反向 drop attachment references。 link 可以替換 `_LinkedShaders` 的內容，但不會把 attached input 陣列變成 executable 陣列。 這使 relink、查詢 attached shaders 與目前可執行 stages 各有獨立 ownership

#### 每個 stage 的 executable object

Link 成功後，draw 需要的是各 stage 的 executable，而不是 attached shader 陣列本身。 讀 `gl_linked_shader::Program`、`gl_program::nir` 與 `_mesa_use_shader_program()`，才能看見 program binding 如何把 link 結果逐 stage 安裝到 context，並確定 driver 最後接收哪一層 IR owner

以下程式碼來自 [Mesa: src/mesa/main/shader_types.h:259](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L259-266) 與 [Mesa: src/mesa/main/shader_types.h:484](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L484-501)，分別摘錄 `struct gl_linked_shader` 與 `struct gl_program`

欄位顯示 linked wrapper 以 `Stage` 指向一個 executable `Program`。 後者另有 `info`、reference state 與 `nir` pointer，與 program container 的 attached-shader 陣列分開：

```c
struct gl_linked_shader
{
   mesa_shader_stage Stage;

   struct gl_program *Program;  /**< Post-compile assembly code */
...
struct gl_program
{
   /** FIXME: This must be first until we split shader_info from nir_shader */
   struct shader_info info;

   GLuint Id;
   GLint RefCount;
   GLubyte *String;  /**< Null-terminated program text */
...
   GLboolean _Used;        /**< Ever used for drawing? Used for debugging */

   struct nir_shader *nir;
   void *base_serialized_nir;
   size_t base_serialized_nir_size;
...
```

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:1544](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L1544-1558) 的 `_mesa_use_shader_program()`，用來確認 program binding 如何逐 stage 安裝 link 結果。 Loop 讀取 `shProg->_LinkedShaders[i]->Program`，用 `_mesa_reference_program()` 更新 context stage binding，最後再替 active shader-program slot 取得 container reference：

```c
/**
 * Use the named shader program for subsequent rendering.
 */
void
_mesa_use_shader_program(struct gl_context *ctx,
                         struct gl_shader_program *shProg)
{
   for (int i = 0; i < MESA_SHADER_MESH_STAGES; i++) {
      struct gl_program *new_prog = NULL;
      if (shProg && shProg->_LinkedShaders[i])
         new_prog = shProg->_LinkedShaders[i]->Program;
      _mesa_use_program(ctx, i, shProg, new_prog, &ctx->Shader);
   }
   _mesa_active_program(ctx, shProg, "glUseProgram");
}
```

因此 shared program object 讓多個 contexts 看見同一組 link 結果，current program 與各 stage binding 卻仍由各自 `gl_context` 保存 references。 program name、`gl_shader_program` pointer、linked-stage pointer 與 `gl_program` pointer 是四個不同層級

#### DeletePending 與最後一個 reference

Application 可能在 shader 尚被 program attach、或 program 尚為 current 時送出 delete。 需要追 `DeletePending` 與 shader/program reference helpers，才能判定 API handle 何時標成待刪、hash entry 何時移除，以及 source、attachment 與 linked storage 的真正 teardown 時點

shader／program 的 delete 規則不同於前述 buffer、texture 與 sampler。 delete 呼叫設 `DeletePending` 並 drop 建立時的 owner reference，但 name 仍留在 `ShaderObjects`，直到 object 的 refcount 真正歸零

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:452](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L452-498) 的 `delete_shader_program()` 與 `delete_shader()`。 Delete 分支可觀察 lookup 失敗直接回傳，第一次 delete 才設定 `DeletePending`，並各自放掉 namespace 所持的 program／shader reference。 attachments 與 current program slots 可繼續延長 object 生命週期：

```c
static void
delete_shader_program(struct gl_context *ctx, GLuint name)
{
...
   shProg = _mesa_lookup_shader_program_err(ctx, name, "glDeleteProgram");
   if (!shProg)
      return;

   if (!shProg->DeletePending) {
      shProg->DeletePending = GL_TRUE;

      /* effectively, decr shProg's refcount */
      _mesa_reference_shader_program(ctx, &shProg, NULL);
   }
}
...
static void
delete_shader(struct gl_context *ctx, GLuint shader)
{
...
   if (!sh->DeletePending) {
      sh->DeletePending = GL_TRUE;

      /* effectively, decr sh's refcount */
      _mesa_reference_shader(ctx, &sh, NULL);
   }
}
```

以下程式碼分別來自 [Mesa: src/mesa/main/shaderobj.c:68](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderobj.c#L68-92) 的 `_reference_shader()`，以及 [Mesa: src/mesa/main/shaderobj.c:247](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderobj.c#L247-269) 的 `_mesa_reference_shader_program_()` 最終釋放分支

兩條分支顯示 `p_atomic_dec_zero()` 如何判定 destructor：先從 shared `ShaderObjects` 移除 nonzero `Name`，program 路徑還會在同一把 hash mutex 內完成 container teardown：

```c
static void
_reference_shader(struct gl_context *ctx, struct gl_shader **ptr,
                  struct gl_shader *sh, bool skip_locking)
{
...
      if (p_atomic_dec_zero(&old->RefCount)) {
         if (old->Name != 0) {
            if (skip_locking)
               _mesa_HashRemoveLocked(&ctx->Shared->ShaderObjects, old->Name);
            else
               _mesa_HashRemove(&ctx->Shared->ShaderObjects, old->Name);
         }
         _mesa_delete_shader(ctx, old);
      }
...
}

void
_mesa_reference_shader_program_(struct gl_context *ctx,
                                struct gl_shader_program **ptr,
                                struct gl_shader_program *shProg)
{
...
      if (p_atomic_dec_zero(&old->RefCount)) {
         _mesa_HashLockMutex(&ctx->Shared->ShaderObjects);
         if (old->Name != 0)
	         _mesa_HashRemoveLocked(&ctx->Shared->ShaderObjects, old->Name);
         _mesa_delete_shader_program(ctx, old);
         _mesa_HashUnlockMutex(&ctx->Shared->ShaderObjects);
      }
...
}
```

兩個 decrement 分支都以 `p_atomic_dec_zero()` 作為最終釋放的判斷條件。 shader 先從 shared hash 移除 `Name` 再刪除，program 則在同一把 hash mutex 內完成 remove 與 teardown。 `DeletePending` 只啟動 unreference，真正的 object 銷毀仍由 refcount 歸零決定

```callgraph
Mesa OpenGL frontend：shader／program DeletePending 與最終釋放
=================================================
[Mesa: src/mesa/main/shaderapi.c:318] attach_shader(ctx, shProg, shader)
  │
  ├─ 若 shader 已在 shProg->Shaders[]
  │    └─ return
  └─ 擴充陣列後 _mesa_reference_shader(..., shader);
       // program attachment 新增一份 shader ownership
  ↓
[Mesa: src/mesa/main/shaderapi.c:452] delete_shader_program(ctx, obj)
  │
  ├─ if (obj->DeletePending)
  │    └─ return
  └─ obj->DeletePending = GL_TRUE;
       _mesa_reference_shader_program(ctx, &obj, NULL);
       // delete request 只放掉 application 建立時的 owner reference
  ↓
[Mesa: src/mesa/main/shaderobj.c:68] _mesa_reference_shader(...)
  │
  ├─ if (p_atomic_dec_zero(&old->RefCount))
  │    ├─ _mesa_HashRemove(..., old->Name);
  │    └─ _mesa_delete_shader(ctx, old);
  └─ attachment 仍存在：保留 source、compile 結果與 NIR
  ↓
[Mesa: src/mesa/main/shaderobj.c:247] _mesa_reference_shader_program(...)
  │
  └─ refcount 歸零：移除 hash entry，再釋放 attachments 與 linked stages
       // 結果：current binding／attachment 都解除後才結束 storage 生命週期
```

完整生命週期因而分成三條相扣的 ownership。 shader object 擁有 source 與 compile 結果，program object 擁有 attachments 與 linked-stage containers，context binding 擁有目前使用中的 program references。 `DeletePending` 記錄 API 已送出 deletion request，最後一個 reference 才結束實際 storage 生命週期

### VAO、renderbuffer 與 framebuffer

Draw 需要一組 vertex inputs，也需要一組可寫入的 framebuffer attachments。 VAO、renderbuffer 與 FBO 各自保存不同 reference graph。 沿 bind、attach、completeness 與 delete 的實作閱讀，才能分辨 vertex buffer storage、attachment view 與 framebuffer container 的生命週期

#### VAO 保存 vertex format、vertex buffers 與 element buffer

Application 綁定 VAO 後，draw 必須從它找到 attribute format、binding index、vertex buffer 與 element buffer。 需要讀 per-context `Array.Objects`、`bind_vertex_array()` 與最後一個 reference 的 teardown，才能知道 VAO name 為何不跨 share group，以及刪除 VAO 時哪些 buffer references 會被放掉

VAO 是 vertex-input state 的容器。 數值 name 只用來查表，`gl_vertex_array_object` 才保存每個 attribute 的 format、attribute 到 binding point 的 mapping、vertex-buffer references，以及 element buffer reference

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:1590](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L1590-1649) 的 `struct gl_vertex_array_object`。 欄位顯示 `VertexAttrib[]` 保存 format 與 relative offset，`BufferBinding[]` 以 reference 連到 vertex buffers，`IndexBufferObj` 另持有 element buffer，`Enabled` 等 masks 則保存這組 input state 的摘要：

```c
struct gl_vertex_array_object
{
   /** Name of the VAO as received from glGenVertexArray. */
   GLuint Name;

   GLint RefCount;

   GLchar *Label;       /**< GL_KHR_debug */
...
   /** Vertex attribute arrays */
   struct gl_array_attributes VertexAttrib[VERT_ATTRIB_MAX];

   /** Vertex buffer bindings */
   struct gl_vertex_buffer_binding BufferBinding[VERT_ATTRIB_MAX];

   /** Mask indicating which vertex arrays have vertex buffer associated. */
   GLbitfield VertexAttribBufferMask;
...
   /** Mask of VERT_BIT_* values indicating which arrays are enabled */
   GLbitfield Enabled;
...
   /** The index buffer (also known as the element array buffer in OpenGL). */
   struct gl_buffer_object *IndexBufferObj;
};
```

attribute record 保存 format 與相對 offset，並以 `BufferBindingIndex` 選到另一個陣列中的 binding record。 binding record 才保存 stride、instance divisor 與 `BufferObj` reference。 [Mesa: src/mesa/main/mtypes.h:1501](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L1501-1553) 因此 format 與 storage source 可以獨立變動

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:1652](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L1652-1670) 的 `struct gl_array_attrib`。 欄位顯示 `VAO` 與 `DefaultVAO` 是 current context 的 binding references，`Objects` 是 per-context name table，`SharedAndImmutable` 只標示內部 display-list VAO 的 atomic-refcount mode：

```c
/**
 * Vertex array state
 */
struct gl_array_attrib
{
   /** Currently bound array object. */
   struct gl_vertex_array_object *VAO;

   /** The default vertex array object */
   struct gl_vertex_array_object *DefaultVAO;

   /** The last VAO accessed by a DSA function */
   struct gl_vertex_array_object *LastLookedUpVAO;

   /** These contents are copied to newly created VAOs. */
   struct gl_vertex_array_object DefaultVAOState;

   /** Array objects (GL_ARB_vertex_array_object) */
   struct _mesa_HashTable Objects;
```

一般 application VAO 因而不會因 context sharing 出現在另一個 context 的 `Array.Objects`。 struct 內的 `SharedAndImmutable` 是 display-list VAO 使用的內部例外，決定 refcount 是否採 atomic 操作，不會把 application name table 搬進 share group

建立 VAO 時，Gen 與 Create 都直接配置實體 object。 兩條路只以 `EverBound` 的初值區分，不使用 dummy object。 [Mesa: src/mesa/main/arrayobj.c:1020](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/arrayobj.c#L1020-1046) 顯示 name 與 pointer 插入 `ctx->Array.Objects`

以下程式碼來自 [Mesa: src/mesa/main/arrayobj.c:886](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/arrayobj.c#L886-918) 的 `bind_vertex_array()`，用來確認 name 0、lookup 失敗與成功 binding 三條分支。 name 0 選擇 internal `DefaultVAO`，非零 name 必須在 `ctx->Array.Objects` 找到 object。 no-error 以外的 lookup 失敗產生 `GL_INVALID_OPERATION`，成功才替換 `ctx->Array.VAO` reference：

```c
static ALWAYS_INLINE void
bind_vertex_array(struct gl_context *ctx, GLuint id, bool no_error)
{
...
   if (id == 0) {
      /* The spec says there is no array object named 0, but we use
       * one internally because it simplifies things.
       */
      newObj = ctx->Array.DefaultVAO;
   }
   else {
      /* non-default array object */
      newObj = _mesa_lookup_vao(ctx, id);
      if (!no_error && !newObj) {
         _mesa_error(ctx, GL_INVALID_OPERATION,
                     "glBindVertexArray(non-gen name)");
         return;
      }

      newObj->EverBound = GL_TRUE;
   }

   _mesa_reference_vao(ctx, &ctx->Array.VAO, newObj);
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/arrayobj.c:951](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/arrayobj.c#L951-985) 的 `delete_vertex_arrays()`。 刪除順序顯示 current VAO 先回到 binding 0，hash key 隨即移除讓 ID 可重用，DSA lookup cache 與 namespace references 再逐一解除。 VAO 只有在 refcount 歸零時才走最終 destructor：

```c
static void
delete_vertex_arrays(struct gl_context *ctx, GLsizei n, const GLuint *ids)
{
...
         /* If the array object is currently bound, the spec says "the binding
          * for that object reverts to zero and the default vertex array
          * becomes current."
          */
         if (obj == ctx->Array.VAO)
            _mesa_BindVertexArray_no_error(0);

         /* The ID is immediately freed for re-use */
         _mesa_HashRemoveLocked(&ctx->Array.Objects, obj->Name);

         if (ctx->Array.LastLookedUpVAO == obj)
            _mesa_reference_vao(ctx, &ctx->Array.LastLookedUpVAO, NULL);

         /* Unreference the array object.
          * If refcount hits zero, the object will be deleted.
          */
         _mesa_reference_vao(ctx, &obj, NULL);
...
}
```

`_mesa_reference_vao_` 只有在 count 歸零時呼叫 `_mesa_delete_vao`。 [Mesa: src/mesa/main/arrayobj.c:332](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/arrayobj.c#L332-388) 顯示最終 destructor 逐一 drop vertex-buffer bindings 與 element-buffer reference。 VAO 消失不等於 buffer storage 一起被刪除，buffer 仍遵循獨立的 reference 生命週期

```callgraph
Mesa OpenGL frontend：VAO bind、delete 與 buffer references
=================================================
[Mesa: src/mesa/main/arrayobj.c:886] bind_vertex_array(ctx, name, no_error)
  │
  ├─ if (name == 0)
  │    └─ newObj = ctx->Array.DefaultVAO;
  ├─ lookup 失敗且 !no_error
  │    └─ _mesa_error(ctx, GL_INVALID_OPERATION, ...); return;
  └─ lookup 成功
       └─ _mesa_reference_vao(ctx, &ctx->Array.VAO, newObj);
          // current slot 持有 VAO。 VAO 再持有 vertex/index buffer references
  ↓
[Mesa: src/mesa/main/arrayobj.c:951] delete_vertex_arrays(ctx, n, arrays)
  │
  ├─ if (obj == ctx->Array.VAO)
  │    └─ _mesa_BindVertexArray_no_error(0);
  │       // 先讓 current slot 回到 DefaultVAO
  └─ _mesa_HashRemoveLocked(&ctx->Array.Objects, obj->Name);
       _mesa_reference_vao(ctx, &obj, NULL);
  ↓
[Mesa: src/mesa/main/arrayobj.c:332] _mesa_reference_vao_(ctx, ptr, vao)
  │
  └─ if (old refcount 歸零)
       └─ _mesa_delete_vao(ctx, old);
          // 結果：最終 VAO teardown 才逐一放掉 vertex 與 element buffers
```

#### Renderbuffer 保存 attachment storage view

Application 建立 renderbuffer 並 attach 到 FBO 後，current renderbuffer binding 可以改變，attachment 仍須保持 storage 存活。 讀 `gl_renderbuffer` 內的 `texture`、`surface`、`transfer` 與 reference helper，才能分辨長期 storage、attachment view 與一次 map 的生命週期

renderbuffer 是可被 framebuffer attachment 引用的 image-storage object。 它的 name 位於 `Shared` 的 `RenderBuffers` table，目前 `GL_RENDERBUFFER` binding 則是 context 的 `CurrentRenderbuffer`。 attachment binding 與目前 renderbuffer binding 是兩種不同 references

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2529](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2529-2558) 的 `struct gl_renderbuffer` API-facing 欄位。 欄位顯示 `Name`、`RefCount` 與 `Delete` 控制 object 生命週期，`InternalFormat`／`Format`、尺寸及 sample counts 描述 attachment storage，而 `AllocStorage` 決定重新配置的實作入口：

```c
/**
 * Renderbuffers represent drawing surfaces such as color, depth and/or
 * stencil.  A framebuffer object has a set of renderbuffers.
 * Drivers will typically derive subclasses of this type.
 */
struct gl_renderbuffer
{
   GLuint Name;
   GLchar *Label;         /**< GL_KHR_debug */
   GLint RefCount;
   GLuint Width, Height;
   GLuint Depth;
   GLboolean AttachedAnytime; /**< TRUE if it was attached to a framebuffer */
   GLubyte NumSamples;    /**< zero means not multisampled */
   GLubyte NumStorageSamples; /**< for AMD_framebuffer_multisample_advanced */
   GLenum16 InternalFormat; /**< The user-specified format */
   GLenum16 _BaseFormat;    /**< Either GL_RGB, GL_RGBA, GL_DEPTH_COMPONENT or
                               GL_STENCIL_INDEX. */
   mesa_format Format;      /**< The actual renderbuffer memory format */
   /**
    * Pointer to the texture image if this renderbuffer wraps a texture,
    * otherwise NULL.
    *
    * Note that the reference on the gl_texture_object containing this
    * TexImage is held by the gl_renderbuffer_attachment.
    */
   struct gl_texture_image *TexImage;

   /** Delete this renderbuffer */
   void (*Delete)(struct gl_context *ctx, struct gl_renderbuffer *rb);
```

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2560](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2560-2573) 的 `struct gl_renderbuffer` Gallium 欄位。 這些欄位可用來確認 refcounted `texture` 指向長期 `pipe_resource`，embedded `surface` 保存 attachment view，`transfer`／`transfer_map` 只在 CPU mapping 期間有效，三者具有不同生命週期：

```c
...
   /** Allocate new storage for this renderbuffer */
   GLboolean (*AllocStorage)(struct gl_context *ctx,
                             struct gl_renderbuffer *rb,
                             GLenum internalFormat,
                             GLuint width, GLuint height);

   struct pipe_resource *texture;
   enum pipe_format format_linear;
   enum pipe_format format_srgb;
   struct pipe_surface surface;
   GLboolean defined;        /**< defined contents? */

   struct pipe_transfer *transfer; /**< only used when mapping the resource */
...
```

Gen 只保留 name 並插入 `DummyRenderbuffer`，Create 才立即配置真正 object。 [Mesa: src/mesa/main/fbobject.c:2302](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L2302-2327) 讓 shared hash 的 key 與 value 保持分離

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:1833](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L1833-1861) 的 `bind_renderbuffer()`。 查找流程顯示 nonzero name 先查 shared `RenderBuffers`，missing entry 在 hash lock 內 lazy-allocate object。 name 0 產生 null binding，最後 `_mesa_reference_renderbuffer()` 替 current slot 取得或放掉 ownership：

```c
static void
bind_renderbuffer(GLenum target, GLuint renderbuffer)
{
...
   if (renderbuffer) {
      ...
      if (!newRb) {
         newRb = allocate_renderbuffer_locked(ctx, renderbuffer,
                                              "glBindRenderbufferEXT");
      }
      _mesa_HashUnlockMutex(&ctx->Shared->RenderBuffers);
   }
   else {
      newRb = NULL;
   }

   assert(newRb != &DummyRenderbuffer);

   _mesa_reference_renderbuffer(&ctx->CurrentRenderbuffer, newRb);
}
```

配置 storage 時，Mesa 先由 format、尺寸與 samples 組出 `pipe_resource` template，再以 `resource_create` 取得 resource。 [Mesa: src/mesa/main/renderbuffer.c:251](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/renderbuffer.c#L251-284) 最後更新 embedded surface view

map 路徑使用 `surface.level` 與 `surface.first_layer` 選到 resource subrange，`pipe_texture_map` 再回傳 `transfer`。 unmap 會消耗這個 mapping handle，並將 pointer 設為 NULL。 [Mesa: src/mesa/main/renderbuffer.c:485](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/renderbuffer.c#L485-520) 因此 surface 描述長期 view，transfer 只描述一次 mapping

以下程式碼分別來自 [Mesa: src/mesa/main/renderbuffer.c:485](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/renderbuffer.c#L485-507) 的 `_mesa_map_renderbuffer()`，以及 [Mesa: src/mesa/main/renderbuffer.c:510](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/renderbuffer.c#L510-520) 的 `_mesa_unmap_renderbuffer()`

Map 生命週期會先更新 `rb->surface`，再用它的 level／layer mapping `rb->texture`，並將 transfer object 保存至 `rb->transfer`。 Unmap 生命週期則呼叫 `pipe_texture_unmap()`，隨即將該 pointer 設為 NULL：

```c
void
_mesa_map_renderbuffer(struct gl_context *ctx,
                       struct gl_renderbuffer *rb,
                       GLuint x, GLuint y, GLuint w, GLuint h,
                       GLbitfield mode,
                       GLubyte **mapOut, GLint *rowStrideOut,
                       bool flip_y)
{
...
   _mesa_update_renderbuffer_surface(ctx, rb);
   map = pipe_texture_map(pipe,
                           rb->texture,
                           rb->surface.level,
                           rb->surface.first_layer,
                           transfer_flags, x, y2, w, h, &rb->transfer);
...
}

void
_mesa_unmap_renderbuffer(struct gl_context *ctx,
                         struct gl_renderbuffer *rb)
{
...
   pipe_texture_unmap(pipe, rb->transfer);
   rb->transfer = NULL;
}
```

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:2287](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L2287-2296) 的 `_mesa_DeleteRenderbuffers()` namespace 釋放。 釋放路徑顯示 shared hash key 先移除以釋放 ID，`DummyRenderbuffer` 不需要 destructor，真正 object 則只放掉 hash table reference，仍由 FBO attachment references 決定最終刪除：

```c
void GLAPIENTRY
_mesa_DeleteRenderbuffers(GLsizei n, const GLuint *renderbuffers)
{
...
            /* Remove from hash table immediately, to free the ID.
             * But the object will not be freed until it's no longer
             * referenced anywhere else.
             */
            _mesa_HashRemove(&ctx->Shared->RenderBuffers, renderbuffers[i]);

            if (rb != &DummyRenderbuffer) {
               /* no longer referenced by hash table */
               _mesa_reference_renderbuffer(&rb, NULL);
            }
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/renderbuffer.c:408](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/renderbuffer.c#L408-437) 的 `_mesa_reference_renderbuffer_()`，用來確認 current binding 或 attachment replacement 如何保護 storage，並在最後一個 reference 呼叫 `Delete` callback：

```c
void
_mesa_reference_renderbuffer_(struct gl_renderbuffer **ptr,
                              struct gl_renderbuffer *rb)
{
...
   if (*ptr) {
      /* Unreference the old renderbuffer */
      struct gl_renderbuffer *oldRb = *ptr;
...
      if (p_atomic_dec_zero(&oldRb->RefCount)) {
         GET_CURRENT_CONTEXT(ctx);
         oldRb->Delete(ctx, oldRb);
      }
   }
...
   if (rb) {
      /* reference new renderbuffer */
      p_atomic_inc(&rb->RefCount);
   }
...
   *ptr = rb;
}
```

default `Delete` 在最後一個 reference 時呼叫 `pipe_resource_reference` 放掉 `texture`，再釋放軟體 storage 與 object。 [Mesa: src/mesa/main/renderbuffer.c:62](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/renderbuffer.c#L62-76) embedded surface 隨 object 結束，已完成的 transfer 則應在 unmap 時先被清空

#### FBO 保存 attachment 與 completeness-derived state

Application 把 texture 或 renderbuffer attach 到 FBO 後，draw 必須先知道 attachment 組合是否完整，以及 draw/read bindings 指向哪個 container。 需要追 attachment reference、`invalidate_framebuffer()`、completeness test 與 FBO delete，才能判斷哪次變更使 cache 失效，哪個 owner 維持 storage

FBO 是一組 attachment references、draw／read selection 與 completeness-derived state。 attachment 可以指向 named renderbuffer，也可以同時保存 texture object reference 與指定的 level、face 或 layer

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2591](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2591-2618) 的 `struct gl_renderbuffer_attachment`。 欄位顯示 `Type` 選擇 renderbuffer 或 texture ownership，兩個 pointer 欄位持有對應 object reference，`TextureLevel`／`CubeMapFace`／`Zoffset`／`Layered` 則描述從 texture object 取出的 attachment view：

```c
/**
 * A renderbuffer attachment points to either a texture object (and specifies
 * a mipmap level, cube face or 3D texture slice) or points to a renderbuffer.
 */
struct gl_renderbuffer_attachment
{
   GLenum16 Type; /**< \c GL_NONE or \c GL_TEXTURE or \c GL_RENDERBUFFER_EXT */
   GLboolean Complete;

   /**
    * If \c Type is \c GL_RENDERBUFFER_EXT, this stores a pointer to the
    * application supplied renderbuffer object.
    */
   struct gl_renderbuffer *Renderbuffer;

   /**
    * If \c Type is \c GL_TEXTURE, this stores a pointer to the application
    * supplied texture object.
    */
   struct gl_texture_object *Texture;
   GLuint TextureLevel; /**< Attached mipmap level. */
   GLsizei NumSamples;  /**< from FramebufferTexture2DMultisampleEXT */
   GLuint CubeMapFace;  /**< 0 .. 5, for cube map textures. */
   GLuint Zoffset;      /**< Slice for 3D textures,  or layer for both 1D
                         * and 2D array textures */
   GLboolean Layered;
   GLsizei NumViews;
};
```

`gl_framebuffer` 以 `Name` 與 `RefCount` 管理 container 生命週期。 name 0 表示 winsys framebuffer，非零才是 user FBO。 `Visual`、`Width` 與 `Height` 對 user FBO 都由 attachments 計算

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2621](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2621-2653) 的 `struct gl_framebuffer` container 欄位，用來確認 winsys identity、container 生命週期與 attachment ownership。 `Name == 0` 區分 winsys framebuffer，`RefCount` 控制 container 生命週期，`Attachment[]` 保存 owned views，`Visual`、`Width` 與 `Height` 則由 user-FBO attachments 推導：

```c
/**
 * A framebuffer is a collection of renderbuffers (color, depth, stencil, etc).
 * In C++ terms, think of this as a base class from which device drivers
 * will make derived classes.
 */
struct gl_framebuffer
{
   simple_mtx_t Mutex;  /**< for thread safety */
   /**
    * If zero, this is a window system framebuffer.  If non-zero, this
    * is a FBO framebuffer; note that for some devices (i.e. those with
    * a natural pixel coordinate system for FBOs that differs from the
    * OpenGL/Mesa coordinate system), this means that the viewport,
    * polygon face orientation, and polygon stipple will have to be inverted.
    */
   GLuint Name;
   GLint RefCount;

   GLchar *Label;       /**< GL_KHR_debug */

   GLboolean DeletePending;

   /**
    * The framebuffer's visual. Immutable if this is a window system buffer.
    * Computed from attachments if user-made FBO.
    */
   struct gl_config Visual;

   /**
    * Size of frame buffer in pixels. If there are no attachments, then both
    * of these are 0.
    */
   GLuint Width, Height;
```

completeness 結果保存在 `_Status`。 `_HasAttachments`、format masks、sample state 與 layer count 也由 attachment set 推導，不是 application 另外建立的 objects。 [Mesa: src/mesa/main/mtypes.h:2685](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2685-2704) 列出第一組 derived 欄位

同一 struct 的 `Attachment[]` 是 ownership 邊，`_ColorDrawBuffers[]` 與 `_ColorReadBuffer` 則是由 draw／read selection 解出的快速 pointers。 [Mesa: src/mesa/main/mtypes.h:2724](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2724-2746) 清楚區分 attachment 陣列與 derived routing

FBO name table 位於 `ctx->Shared->FrameBuffers`。 Gen 插入 dummy，Create 立即配置 object，bind dummy name 時才完成延遲建立。 [Mesa: src/mesa/main/fbobject.c:3535](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L3535-3555) 顯示 share-group namespace

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:3342](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L3342-3370) 的 `bind_framebuffer()` object lookup。 Lookup 分支顯示 nonzero name 在 shared hash 內查找或配置 FBO，配置失敗產生 `GL_OUT_OF_MEMORY`。 name 0 則選擇 winsys draw／read buffers，再交給 `_mesa_bind_framebuffers()` 更新 context slots：

```c
static void
bind_framebuffer(GLenum target, GLuint framebuffer)
{
...
   if (framebuffer) {
      _mesa_HashLockMutex(&ctx->Shared->FrameBuffers);
...
      newDrawFb = _mesa_lookup_framebuffer_locked(ctx, framebuffer);
...
      if (!newDrawFb) {
         /* create new framebuffer object */
         newDrawFb = _mesa_new_framebuffer(ctx, framebuffer);
         if (!newDrawFb) {
            _mesa_HashUnlockMutex(&ctx->Shared->FrameBuffers);
            _mesa_error(ctx, GL_OUT_OF_MEMORY, "glBindFramebufferEXT");
            return;
         }
         _mesa_HashInsertLocked(&ctx->Shared->FrameBuffers, framebuffer, newDrawFb);
      }
      _mesa_HashUnlockMutex(&ctx->Shared->FrameBuffers);
      newReadFb = newDrawFb;
...
   }
   ...
}
```

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:3412](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L3412-3432) 的 `_mesa_bind_framebuffers()`。 修改順序顯示 read 分支以 `_NEW_BUFFERS` flush 並替換 `ctx->ReadBuffer`，draw 分支另檢查 texture attachments、清除 valid-to-render cache，最後更新 `ctx->DrawBuffer` 與 State Tracker sample／framebuffer dirtiness：

```c
void
_mesa_bind_framebuffers(struct gl_context *ctx,
                        struct gl_framebuffer *newDrawFb,
                        struct gl_framebuffer *newReadFb)
{
...
   if (bindReadBuf) {
      FLUSH_VERTICES(ctx, _NEW_BUFFERS, 0);

      _mesa_reference_framebuffer(&ctx->ReadBuffer, newReadFb);
   }
...
   if (bindDrawBuf) {
...
      /* check if newly bound framebuffer has any texture attachments */
      check_begin_texture_render(ctx, newDrawFb);

      _mesa_reference_framebuffer(&ctx->DrawBuffer, newDrawFb);
      _mesa_update_allow_draw_out_of_order(ctx);
      _mesa_update_valid_to_render_state(ctx);
...
   }
}
```

attachment replacement 先 drop 舊 reference，再取得新 reference。 renderbuffer attachment 以 `_mesa_reference_renderbuffer` 保存 object，texture attachment 則在 `Texture` 欄位保存 texture reference。 [Mesa: src/mesa/main/fbobject.c:665](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L665-681) 顯示 renderbuffer case

attachment 被替換或移除時，completeness cache 必須一起失效。 [`Mesa: src/mesa/main/fbobject.c:625`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L625-651) 的 `set_texture_attachment()` 先解除舊 attachment、取得新 texture reference，再呼叫 `invalidate_framebuffer(fb)`

renderbuffer 路徑也會在 [`Mesa: src/mesa/main/fbobject.c:681`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L681-722) 的 `_mesa_FramebufferRenderbuffer_sw()` 完成 attachment mutation 後執行同一個 invalidation helper。 下一次 status query 才會重新執行 completeness test

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:243](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L243-252) 的 `invalidate_framebuffer()`，以及 [Mesa: src/mesa/main/fbobject.c:3587](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L3587-3594) 的 `_mesa_check_framebuffer_status()`。 這組片段用來追蹤 attachment mutation 如何使 cache 失效，以及 status query 在什麼條件下重新計算 completeness：

```c
/**
 * Mark the given framebuffer as invalid.  This will force the
 * test for framebuffer completeness to be done before the framebuffer
 * is used.
 */
static void
invalidate_framebuffer(struct gl_framebuffer *fb)
{
   fb->_Status = 0; /* "indeterminate" */
}

GLenum
_mesa_check_framebuffer_status(struct gl_context *ctx,
                               struct gl_framebuffer *buffer)
{
...
   /* No need to flush here */

   if (buffer->_Status != GL_FRAMEBUFFER_COMPLETE) {
      _mesa_test_framebuffer_completeness(ctx, buffer);
   }

   return buffer->_Status;
}
```

第一段 assignment 顯示 invalidation 只把 cached `_Status` 清成 indeterminate，不在 mutation 當下執行完整測試。 第二段則是 status query 的 recomputation gate：只要 `_Status` 尚未是 `GL_FRAMEBUFFER_COMPLETE`，便呼叫 `_mesa_test_framebuffer_completeness()`，最後回傳新計算的 framebuffer status

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:1754](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L1754-1781) 的 `_mesa_test_framebuffer_completeness()` 成功收尾。 成功路徑顯示 core 先更新 drawbuffer masks 並暫設 complete status，driver 驗證若改寫 `_Status` 就走 incomplete 回傳路徑。 成功才提交 derived `Width`、`Height`、`Visual` 與 attachment summaries：

```c
void
_mesa_test_framebuffer_completeness(struct gl_context *ctx,
                                    struct gl_framebuffer *fb)
{
...
   _mesa_update_drawbuffer_masks(ctx, fb);

   /* Provisionally set status = COMPLETE ... */
   fb->_Status = GL_FRAMEBUFFER_COMPLETE_EXT;
...
   do_validate_framebuffer(ctx, fb);
   if (fb->_Status != GL_FRAMEBUFFER_COMPLETE_EXT) {
      fbo_incomplete(ctx, "driver marked FBO as incomplete", -1);
      return;
   }

...
   if (numImages != 0) {
      fb->Width = minWidth;
      fb->Height = minHeight;
   }
...
   /* finally, update the visual info for the framebuffer */
   _mesa_update_framebuffer_visual(ctx, fb);
}
```

以下程式碼來自 [Mesa: src/mesa/main/fbobject.c:3473](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/fbobject.c#L3473-3506) 的 `_mesa_DeleteFramebuffers()`。 刪除順序顯示被呼叫端 context 綁為 draw／read 的 FBO 先各自 bind 0，shared hash key 隨即移除，最後只放掉 namespace reference。 其他 context bindings 可繼續持有同一 container 及其 attachments：

```c
void GLAPIENTRY
_mesa_DeleteFramebuffers(GLsizei n, const GLuint *framebuffers)
{
...
            /* check if deleting currently bound framebuffer object */
            if (fb == ctx->DrawBuffer) {
               /* bind default */
               assert(fb->RefCount >= 2);
...
               _mesa_BindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
            }
            if (fb == ctx->ReadBuffer) {
               /* bind default */
               assert(fb->RefCount >= 2);
               _mesa_BindFramebuffer(GL_READ_FRAMEBUFFER, 0);
            }

            /* remove from hash table immediately, to free the ID */
            _mesa_HashRemove(&ctx->Shared->FrameBuffers, framebuffers[i]);
...
               _mesa_reference_framebuffer(&fb, NULL);
...
}
```

以下程式碼來自 [Mesa: src/mesa/main/framebuffer.c:196](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/framebuffer.c#L196-225) 的 `_mesa_free_framebuffer_data()`，用來確認 FBO 最終 teardown 會逐一放掉 renderbuffer 與 texture attachment references：

```c
void
_mesa_free_framebuffer_data(struct gl_framebuffer *fb)
{
...
   for (unsigned i = 0; i < BUFFER_COUNT; i++) {
      struct gl_renderbuffer_attachment *att = &fb->Attachment[i];
      if (att->Renderbuffer) {
         _mesa_reference_renderbuffer(&att->Renderbuffer, NULL);
      }
      if (att->Texture) {
         _mesa_reference_texobj(&att->Texture, NULL);
      }
      assert(!att->Renderbuffer);
      assert(!att->Texture);
      att->Type = GL_NONE;
   }
...
}
```

每個 attachment slot 都分別放掉 `Renderbuffer` 與 `Texture` reference，接著以 assertion 確認 pointer 已清空，並將 `Type` 重設為 `GL_NONE`。 FBO container 的最終 teardown 只解除它持有的 attachment ownership。 相同 storage 若還被其他 object 引用，會依自身 refcount 繼續存活

```callgraph
Mesa OpenGL frontend：FBO binding、completeness 與 attachment 生命週期
=================================================
FBO binding event
=================================================
[Mesa: src/mesa/main/fbobject.c:3307] bind_framebuffer(target, name)
  │
  ├─ switch (target) 無合法 case
  │    └─ _mesa_error(ctx, GL_INVALID_ENUM, ...); return;
  ├─ if (name == 0)
  │    └─ newDrawFb／newReadFb = ctx->WinSys*Buffer;
  └─ name != 0
       ├─ lookup／lazy-create Shared->FrameBuffers[name]
       └─ 配置失敗：GL_OUT_OF_MEMORY。 return
  ↓
[Mesa: src/mesa/main/fbobject.c:3388] _mesa_bind_framebuffers(ctx, draw, read)
  │
  ├─ bindReadBuf：_mesa_reference_framebuffer(&ctx->ReadBuffer, read);
  └─ bindDrawBuf
       ├─ ctx->NewState |= _NEW_BUFFERS;
       ├─ ctx->NewDriverState |= ST_NEW_SAMPLE_STATE;
       └─ _mesa_reference_framebuffer(&ctx->DrawBuffer, draw);
            // 最終結果：per-context slot 改為持有新的 FBO container

Framebuffer attachment mutation event
=================================================
[Mesa: src/mesa/main/fbobject.c:4130] _mesa_framebuffer_texture(ctx, fb, attachment, ...)
  │
  ├─ texObj != NULL
  │    ├─ matching depth／stencil attachment：reuse_framebuffer_texture_attachment(...)
  │    └─ otherwise
  │         └─ [Mesa: src/mesa/main/fbobject.c:625] set_texture_attachment(ctx, fb, att, texObj, ...)
  │              ├─ remove_attachment(ctx, att)
  │              ├─ _mesa_reference_texobj(&att->Texture, texObj)
  │              └─ invalidate_framebuffer(fb)
  ├─ texObj == NULL：remove_attachment(ctx, att)
  └─ invalidate_framebuffer(fb)
       // common tail：attachment identity 改變後，cached completeness 變成 indeterminate

Framebuffer status query event
=================================================
[Mesa: src/mesa/main/fbobject.c:3573] _mesa_check_framebuffer_status(ctx, fb)
  │
  ├─ winsys FBO：依 IncompleteFramebuffer identity 直接回傳 COMPLETE／UNDEFINED
  ├─ fb->_Status == GL_FRAMEBUFFER_COMPLETE：直接回傳 cached status
  └─ fb->_Status != GL_FRAMEBUFFER_COMPLETE
       ↓
     [Mesa: src/mesa/main/fbobject.c:1313] _mesa_test_framebuffer_completeness(ctx, fb)
       ├─ 任一 attachment／driver check 失敗
       │    └─ 保留 incomplete status。 return
       └─ 成功：fb->_Status = GL_FRAMEBUFFER_COMPLETE_EXT;
            fb->Width = minWidth; fb->Height = minHeight;
            // 最終結果：status query 得到重新計算的 completeness 與尺寸

FBO deletion event
=================================================
[Mesa: src/mesa/main/fbobject.c:3453] _mesa_DeleteFramebuffers(...)
  │
  ├─ if (fb == ctx->DrawBuffer／ReadBuffer) 先 bind name 0
  └─ 移除 hash key。 最後一個 reference 才釋放所有 texture／renderbuffer attachments
```

### Query 與 sync object

Rendering work 已能提交後，application 還需要查詢計數結果或等待某個 command-stream 時點。 Query 以 per-context active slot 驅動 begin、end 與結果取得，sync 則以 share-group pointer set 和 driver fence 支撐跨 context wait。 讀兩條生命週期，才能分辨輪詢、阻塞與 delete 對 completion 的影響

#### Query object 的 active／結果生命週期

Application 呼叫 BeginQuery、EndQuery，再選擇輪詢或阻塞取得結果。 需要讀 active target slot、`Active`／`Ready` 欄位與 Gallium `pipe_query` callback，才能判斷錯誤分支、結果何時寫回，以及 delete 為何不像 refcounted buffer 那樣延後

query object 的 namespace 與 active bindings 都在 `gl_context`，不在 share group。 `gl_query_object` 保存數值 ID、target、`Active`／`Ready` flags、cached `Result`，以及對應的 Gallium `pipe_query` handles

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2328](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2328-2375) 的 `struct gl_query_object`。 欄位顯示 `Id`／`Target` 定義 per-context identity，`Active`、`Ready`、`EverBound` 與 `Stream` 記錄 API 生命週期，`Result` 保存 counter，`pq`／`pq_begin` 則保存 Gallium query handles：

```c
struct gl_query_object
{
   GLenum16 Target;    /**< The query target, when active */
   GLuint Id;          /**< hash table ID/name */
   GLchar *Label;      /**< GL_KHR_debug */
   GLuint64EXT Result; /**< the counter */
   GLboolean Active;   /**< inside Begin/EndQuery */
   GLboolean Ready;    /**< result is ready? */
   GLboolean EverBound;/**< has query object ever been bound */
   GLuint Stream;      /**< The stream */

   struct pipe_query *pq;

   /* Begin TIMESTAMP query for GL_TIME_ELAPSED_EXT queries */
   struct pipe_query *pq_begin;

   unsigned type;  /**< PIPE_QUERY_x */
};
...
struct gl_query_state
{
   struct _mesa_HashTable QueryObjects;
   struct gl_query_object *CurrentOcclusionObject; /* GL_ARB_occlusion_query */
   struct gl_query_object *CurrentTimerObject;     /* GL_EXT_timer_query */
...
   /** GL_ARB_timer_query */
   struct gl_query_object *TimeElapsed;

   /** GL_ARB_pipeline_statistics_query */
   struct gl_query_object *pipeline_stats[MAX_PIPELINE_STATISTICS];
...
```

Gen 與 Create 都配置真正 query object 並插入 `ctx->Query.QueryObjects`。 Create 另外預先設定 target 與 `EverBound`。 [Mesa: src/mesa/main/queryobj.c:606](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/queryobj.c#L606-657) 因此 query name 仍是 hash key，不是 `pipe_query` pointer

Begin 先找到 target 對應的 active slot，確定沒有另一個 active query。 接著寫入 target 與 stream，`Result` 歸零，`Ready` 也改為 false，最後令 active slot 指向 query object

以下程式碼來自 [Mesa: src/mesa/main/queryobj.c:822](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/queryobj.c#L822-875) 的 `_mesa_BeginQueryIndexed()` 與 `_mesa_EndQueryIndexed()`，用來追蹤 query 的完整 state 轉換。 Begin 寫入 target／stream 與 `Active`，清空結果，並將 raw pointer 放進 active slot。 End 先清空 slot，missing／inactive object 產生 error，成功才清掉 `Active` 並呼叫 `end_query()`：

```c
void GLAPIENTRY
_mesa_BeginQueryIndexed(GLenum target, GLuint index, GLuint id)
{
...
   q->Target = target;
   q->Active = GL_TRUE;
   q->Result = 0;
   q->Ready = GL_FALSE;
   q->EverBound = GL_TRUE;
   q->Stream = index;

   /* XXX should probably refcount query objects */
   *bindpt = q;

   begin_query(ctx, q);
...
}

void GLAPIENTRY
_mesa_EndQueryIndexed(GLenum target, GLuint index)
{
...
   *bindpt = NULL;

   if (!q || !q->Active) {
      _mesa_error(ctx, GL_INVALID_OPERATION,
                  "glEndQuery{Indexed}(no matching glBeginQuery{Indexed})");
      return;
   }

   q->Active = GL_FALSE;
   end_query(ctx, q);
}
```

`begin_query` 依 target 選 Gallium query type，必要時以 `pipe->create_query` lazy-create `pq`，再呼叫 `pipe->begin_query`。 `end_query` 則呼叫 `pipe->end_query`。 [Mesa: src/mesa/main/queryobj.c:213](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/queryobj.c#L213-286) `pq_begin` 只用於需要兩個 timestamp handles 的 elapsed-time case

結果 request 有阻塞與輪詢兩條路。 `_mesa_wait_query` 以 `wait=true` 取得 driver 結果，直到 `Ready` 成立。 `_mesa_check_query` 只做一次非阻塞 check

[Mesa: src/mesa/main/queryobj.c:382](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/queryobj.c#L382-406) 顯示取得的 counter 會由 `get_query_result` 寫回 `q->Result`

這個固定版本的 query object 沒有 `RefCount`。 active slot 是 raw pointer，source 也留下應加入 refcount 的註記。 Delete 若遇到 active query，會先清空 slot 並呼叫 `end_query`

接著移除 per-context name 並立即 `destroy_query`／free object。 [Mesa: src/mesa/main/queryobj.c:660](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/queryobj.c#L660-691) 與 [Mesa: src/mesa/main/queryobj.c:60](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/queryobj.c#L60-83) 因此不能套用延後到最後一個 reference 的模型

```callgraph
Mesa OpenGL frontend：query active slot、結果與 destroy
=================================================
Application query events
  │
  ├─ Begin／End event
  │    ↓
  │  [Mesa: src/mesa/main/queryobj.c:735] _mesa_BeginQueryIndexed(target, index, id)
  │    ├─ if (*bindpt || id == 0 || q->Active)：GL_INVALID_OPERATION; return
  │    └─ q->Active = GL_TRUE; q->Ready = GL_FALSE; *bindpt = q; begin_query(ctx, q)
  │         // per-context active slot 是 raw pointer，不新增 object refcount
  │         ↓
  │  [Mesa: src/mesa/main/queryobj.c:837] _mesa_EndQueryIndexed(target, index)
  │    ├─ if (!q || !q->Active)：GL_INVALID_OPERATION; return
  │    └─ *bindpt = NULL; q->Active = GL_FALSE; end_query(ctx, q)
  │
  ├─ 結果觀察事件
  │    ↓
  │  [Mesa: src/mesa/main/queryobj.c:401] _mesa_check_query(ctx, q)
  │    ├─ q->Ready = get_query_result(pipe, q, false)
  │    └─ 尚未就緒時可改走阻塞路徑
  │         ↓
  │  [Mesa: src/mesa/main/queryobj.c:383] _mesa_wait_query(ctx, q)
  │    └─ while (!q->Ready && !get_query_result(pipe, q, true)) { }
  │         q->Ready = GL_TRUE
  │         // driver counter 已保存到 q->Result，可回給 application
  │
  └─ DeleteQueries event
       ↓
     [Mesa: src/mesa/main/queryobj.c:660] _mesa_DeleteQueries(n, ids)
       ├─ if (n < 0)：GL_INVALID_VALUE; return
       ├─ if (q->Active)：*bindpt = NULL; q->Active = GL_FALSE; end_query(ctx, q)
       └─ _mesa_HashRemoveLocked(...); delete_query(ctx, q)
            ↓
     [Mesa: src/mesa/main/queryobj.c:60] free_queries(pipe, q)
       ├─ if (q->pq)：pipe->destroy_query(pipe, q->pq)
       └─ if (q->pq_begin)：pipe->destroy_query(pipe, q->pq_begin)
            // 最終結果：per-context name 移除，Gallium query handles 與 wrapper 立即釋放
```

#### GL sync object 與 driver fence

Application 插入 `glFenceSync()` 後會拿到 opaque `GLsync`，稍後可能從同一 share group 裡的另一個 context wait 或 delete。 需要追 shared pointer set、GL object refcount 與 `pipe_fence_handle` 的本地 reference，才能確保 unlocked wait 期間 fence 不被釋放，並找出 DeleteSync 真正終止 object 的條件

sync object 可跨 sharing contexts 使用，但不綁到任何 context slot。 `Shared->SyncObjects` 是以 object pointer 為 key 的 set，用來驗證 opaque `GLsync` handle。 struct 的 `Name` 欄位在這個 API 中固定為 1，application 看不到它

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2386](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2386-2401) 的 `struct gl_sync_object`，用來確認 GL wrapper 生命週期、API-visible status 與 driver fence 的欄位分工。 `RefCount`／`DeletePending` 管理 wrapper，`SyncCondition` 與 `StatusFlag` 保存 sync state，`mutex` 保護可由 wait 路徑複製或清除的 `fence` pointer：

```c
/** Sync object state */
struct gl_sync_object
{
   GLuint Name;               /**< Fence name */
   GLint RefCount;            /**< Reference count */
   GLchar *Label;             /**< GL_KHR_debug */
   GLboolean DeletePending;   /**< Object was deleted while there were still
                               * live references (e.g., sync not yet finished)
                               */
   GLenum16 SyncCondition;
   GLbitfield Flags;          /**< Flags passed to glFenceSync */
   GLuint StatusFlag:1;       /**< Has the sync object been signaled? */

   struct pipe_fence_handle *fence;
   simple_mtx_t mutex; /**< protects "fence" */
};
```

以下程式碼來自 [Mesa: src/mesa/main/syncobj.c:274](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/syncobj.c#L274-304) 的 `_mesa_fence_sync()`。 發布順序顯示 new object 先取得初始 GL reference，single-context share group 可加上 `PIPE_FLUSH_DEFERRED`，`pipe->flush()` 將 driver fence 寫入 `syncObj->fence`，最後 shared pointer set 才公布 opaque `GLsync` handle：

```c
GLsync
_mesa_fence_sync(struct gl_context *ctx, GLenum condition, GLbitfield flags)
{
   struct gl_sync_object *syncObj;

   syncObj = new_sync_object(ctx);
   if (syncObj != NULL) {
...
      syncObj->Name = 1;
      syncObj->RefCount = 1;
      syncObj->DeletePending = GL_FALSE;
      syncObj->SyncCondition = condition;
      syncObj->Flags = flags;
      syncObj->StatusFlag = 0;
...
      assert(syncObj->fence == NULL);
...
      ctx->pipe->flush(ctx->pipe, &syncObj->fence, ctx->Shared->RefCount == 1 ? PIPE_FLUSH_DEFERRED : 0);

      simple_mtx_lock(&ctx->Shared->Mutex);
      _mesa_set_add(ctx->Shared->SyncObjects, syncObj);
      simple_mtx_unlock(&ctx->Shared->Mutex);

      return (GLsync)syncObj;
...
   }
   ...
}
```

`_mesa_fence_sync()` 最後直接把 `gl_sync_object *` cast 成 opaque `GLsync` 回傳。 Application 持有的是這個 pointer identity； struct 內固定為 1 的 `Name` 不是對外查找 object 的數值名稱。 後續使用 `GLsync` 時，Mesa 會先檢查該 pointer 是否仍存在於 share group 的 `SyncObjects` set，並確認它尚未進入 `DeletePending` 階段

share group 只有一個 context 時，flush 可以要求 `PIPE_FLUSH_DEFERRED`。 這會建立 command-order marker，但不保證 FenceSync 當下已真正 submit。 [`Mesa: src/gallium/include/pipe/p_screen.h:403`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L403-418) 的 `pipe_screen::fence_finish` contract 規定，同一個 context 後續等待尚未 flush 的 deferred fence 時，driver 必須先 flush 該 context

等待前，`_mesa_get_and_ref_sync` 在 shared mutex 內檢查 pointer 仍在 set 且尚未 delete，並增加 GL object reference。 `_mesa_unref_sync_object` 在 count 歸零時先移除 set entry，再刪除 object。 [Mesa: src/mesa/main/syncobj.c:176](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/syncobj.c#L176-213) 防止另一個執行緒在 wait 中途釋放 sync

wait 還要取得第二層 reference。 object mutex 內，`screen->fence_reference` 把 `obj->fence` 複製到 local fence，讓 `fence_finish` 可以在解鎖後等待。 signal 成立時清掉 object 持有的 driver fence，再 drop local fence reference

以下程式碼來自 [Mesa: src/mesa/main/syncobj.c:117](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/syncobj.c#L117-161) 的 `__client_wait_sync()`。 Wait 路徑可觀察 object mutex 下的 null fence 直接設定 `StatusFlag`。 否則 `fence_reference()` 先取得 local driver reference，解鎖後執行 `fence_finish()`，signal 成功再清掉 object fence 並放掉 local reference：

```c
static void
__client_wait_sync(struct gl_context *ctx,
                   struct gl_sync_object *obj,
                   GLbitfield flags, GLuint64 timeout)
{
...
   simple_mtx_lock(&obj->mutex);
   if (!obj->fence) {
      simple_mtx_unlock(&obj->mutex);
      obj->StatusFlag = GL_TRUE;
      return;
   }
...
   screen->fence_reference(screen, &fence, obj->fence);
   simple_mtx_unlock(&obj->mutex);
...
   if (screen->fence_finish(screen, pipe, fence, timeout)) {
      simple_mtx_lock(&obj->mutex);
      screen->fence_reference(screen, &obj->fence, NULL);
      simple_mtx_unlock(&obj->mutex);
      obj->StatusFlag = GL_TRUE;
   }
   screen->fence_reference(screen, &fence, NULL);
}
```

DeleteSync 先取得臨時 GL reference，設 `DeletePending`，再一次 drop owner 與臨時 references。 outstanding client／server waits 若仍持有 references，object 會延後釋放

以下程式碼來自 [Mesa: src/mesa/main/syncobj.c:226](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/syncobj.c#L226-255) 與 [Mesa: src/mesa/main/syncobj.c:105](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/syncobj.c#L105-115) 的 `delete_sync_object()` 與 DeleteSync tail。 Refcount 的變化顯示公開 delete 先取得臨時 reference、設定 `DeletePending`，再一次 unref 2。 只有 count 歸零才進 destructor，放掉 `obj->fence`、mutex、label 與 wrapper storage：

```c
static void
delete_sync_object(struct gl_context *ctx,
                      struct gl_sync_object *obj)
{
   struct pipe_screen *screen = ctx->pipe->screen;

   screen->fence_reference(screen, &obj->fence, NULL);
   simple_mtx_destroy(&obj->mutex);
   free(obj->Label);
   FREE(obj);
}

static ALWAYS_INLINE void
delete_sync(struct gl_context *ctx, GLsync sync, bool no_error)
{
...
   syncObj = _mesa_get_and_ref_sync(ctx, sync, true);
...
   /* If there are no client-waits or server-waits pending on this sync, delete
    * the underlying object. Note that we double-unref the object, as
    * _mesa_get_and_ref_sync above took an extra refcount to make sure the
    * pointer is valid for us to manipulate.
    */
   syncObj->DeletePending = GL_TRUE;
   _mesa_unref_sync_object(ctx, syncObj, 2);
}
```

`_mesa_get_and_ref_sync()` 先取得一份操作期間的臨時 reference，DeleteSync 再設定 `DeletePending` 並以 count 2 同時放掉公開 owner 與臨時 reference。 只有最終 unreference 進入 `delete_sync_object()` 時才清除 `obj->fence`，因此仍在等待的 references 會把 driver fence 生命週期一起延後

```callgraph
Mesa OpenGL frontend：GLsync 與 driver fence 生命週期
=================================================
[Mesa: src/mesa/main/syncobj.c:274] _mesa_fence_sync(ctx, condition, flags)
  │
  ├─ if (new_sync_object(ctx) == NULL)
  │    └─ return NULL
  └─ 成功
       ├─ syncObj->RefCount = 1; syncObj->DeletePending = GL_FALSE;
       ├─ ctx->pipe->flush(..., &syncObj->fence, flush_flags);
       └─ _mesa_set_add(ctx->Shared->SyncObjects, syncObj);
          // opaque GLsync 由 shared pointer set 驗證
  ↓
[Mesa: src/mesa/main/syncobj.c:382] _mesa_ClientWaitSync(sync, flags, timeout)
  │
  ├─ invalid flags／handle
  │    └─ _mesa_error(...); return GL_WAIT_FAILED;
  └─ valid handle：取得 GL object reference 後進入 wait
       ↓
[Mesa: src/mesa/main/syncobj.c:117] __client_wait_sync(ctx, obj, flags, timeout)
  │
  ├─ if (!obj->fence)
  │    └─ obj->StatusFlag = GL_TRUE; return;
  └─ fence_reference(&local, obj->fence);
       // local fence reference 允許解鎖 obj->mutex 後等待
       ├─ fence_finish(...) 成功：清 obj->fence。 StatusFlag = GL_TRUE;
       └─ fence_reference(&local, NULL);
  ↓
[Mesa: src/mesa/main/syncobj.c:226] delete_sync(ctx, sync, no_error)
  │
  └─ syncObj->DeletePending = GL_TRUE; _mesa_unref_sync_object(..., 2);
       // 結果：最後 GL reference 才由 delete_sync_object 放掉 driver fence
```

VAO 與 query 使用 per-context name table。 renderbuffer 與 FBO names 位於 share group，attachments 與 current bindings 以 references 延長 storage。 sync 沒有 binding slot，由 shared pointer set、GL refcount 與 driver-fence references 保護跨 context wait

## OpenGL state、驗證與 draw

齒輪的 objects 與 bindings 已經就位，application 現在將角度更新到下一個位置，修改這一幀需要的 OpenGL state，再送出 draw。 Mesa 除了記住最後一個 setter 的值，還要判斷這次變更會影響哪些 derived state、draw 是否符合 OpenGL 規則，以及哪些 driver state 必須在真正使用前更新

以下沿 `glEnable()`、`glDrawArrays()`、clear 與 readback 的原始程式碼路徑放大同一幀，展開 setter、合法的提前回傳、error 路徑、dirty bit 與 draw callback

Setter 先更新 API-visible state 與 dependencies。 Draw、clear 或 readback 真正消費 state 時，Mesa 才更新必要的 derived state 並交給 State Tracker。 2D 軟體路徑與 VirGL 3D 路徑都會先經過這段共同處理，直到 Gallium driver callback 才改變執行方式

### State-changing 入口、error 與 no-error context

Application 現在開始呼叫 `glEnable()` 等 setter，Mesa 必須先判斷參數是否合法，再決定是否 flush 舊 work、修改 canonical state 與標記 dirty bits。 這組順序也決定一般 context 如何留下 error，以及 no-error context 能省略哪些驗證。 後面的 draw 是否看見一致 state，取決於這裡的分支

#### API 入口修改 state 並標記 dirty bit

目前的具體問題是同一次 setter 必須同時保護 API state machine 與下層 cached state。 讀 `_mesa_Enable()`、`_mesa_set_enable()` 和 `FLUSH_VERTICES` 的提前回傳、switch 與 bit assignment，才能確認 invalid capability 不會改 state，而有效變更又會讓 draw 前的兩層 consumer 都得知更新

`glEnable()` 的公開入口很薄。 它從執行緒 dispatch 已選定的函式進來，取得 current `gl_context`，把 `GL_TRUE` 交給共用 setter。 `glDisable()` 走相同 setter，只把最後一個參數改成 `GL_FALSE`。 因此 capability 的 legality、redundant-state 提前回傳、dirty marking 與真正的 state write 都集中在 `_mesa_set_enable()`

以下程式碼來自 [Mesa: src/mesa/main/enable.c:1440](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/enable.c#L1440-1450) 的 `_mesa_Enable()` 公開入口，用來確認 API 入口自己處理哪些工作，以及哪個函式負責驗證與 state mutation。 這個邊界只從 TLS 取得 current `ctx`，檢查 Begin／End，再將 `cap` 與固定的 `GL_TRUE` 交給 `_mesa_set_enable()`：

```c
/**
 * Enable GL capability.  Called by glEnable()
 * \param cap  state to enable.
 */
void GLAPIENTRY
_mesa_Enable( GLenum cap )
{
   GET_CURRENT_CONTEXT(ctx);

   _mesa_set_enable( ctx, cap, GL_TRUE );
}
```

`_mesa_set_enable()` 是大型 `switch`，每個 capability 都能有自己的 dependency。 `GL_ALPHA_TEST` 是一個緊湊但完整的例子。 第一段先依 context profile 驗證 capability。 第二段比較 requested state 與 `Color.AlphaEnabled`，相同就直接回傳。 第三段在寫入前呼叫 `FLUSH_VERTICES` 並標記 Mesa core 與 State Tracker 所需的 dirty state。 第四段才更新 authoritative API state

以下程式碼來自 [Mesa: src/mesa/main/enable.c:483](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/enable.c#L483-497) 的 `_mesa_set_enable()` `GL_ALPHA_TEST` case。 判斷條件顯示 profile check 失敗會跳到 invalid-enum 路徑，requested value 與 `Color.AlphaEnabled` 相同時直接回傳。 真正變更才先 flush／標記 `_NEW_COLOR` 等 dependencies，最後寫入 canonical state：

```c
void
_mesa_set_enable(struct gl_context *ctx, GLenum cap, GLboolean state)
{
   switch (cap) {
      case GL_ALPHA_TEST:
         if (!_mesa_is_desktop_gl_compat(ctx) && !_mesa_is_gles1(ctx))
            goto invalid_enum_error;
         if (ctx->Color.AlphaEnabled == state)
            return;
         /* AlphaEnabled is used by the fixed-func fragment program */
         FLUSH_VERTICES(ctx, _NEW_COLOR | _NEW_FF_FRAG_PROGRAM,
                        GL_COLOR_BUFFER_BIT | GL_ENABLE_BIT);
         ST_SET_STATES(ctx->NewDriverState, ctx->DriverFlags.NewAlphaTest);
         ctx->Color.AlphaEnabled = state;
         break;
      ...
   }
}
```

驗證必須在 state write 之前，否則非法呼叫會留下部分 state。 提前回傳也必須在 flush 與 dirty marking 之前，否則重複的 `glEnable()` 雖然沒有改值，仍會讓 buffered vertices 被切斷並觸發無用的重新建立。 `FLUSH_VERTICES` 放在 state write 前，則保證先前 buffered vertices 仍使用舊 state，後續 vertices 才看見新值

這個 macro 的名字容易讓人只想到 command submission。 它的實際 contract 有兩部分。 若 VBO immediate-mode 路徑保存了尚未處理的 vertices，就先呼叫 `vbo_exec_FlushVertices()`

接著不論有沒有 buffered vertices，都將 `newstate` OR 進 `NewState`，並記錄 `PopAttribState`。 所以 `FLUSH_VERTICES(ctx, _NEW_COLOR, ...)` 同時是 ordering barrier 與 Mesa core dirty marker，不等於 Gallium `pipe_context::flush`

以下程式碼來自 [Mesa: src/mesa/main/context.h:172](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.h#L172-190) 的 `FLUSH_VERTICES` 巨集。 巨集展開顯示 `Driver.NeedFlush & FLUSH_STORED_VERTICES` 決定是否先執行 `vbo_exec_FlushVertices()`，common tail 再將呼叫端提供的 masks OR 進 `NewState` 與 `PopAttribState`，同時形成 ordering barrier 和 dirty assignment：

```c
#define FLUSH_VERTICES(ctx, newstate, pop_attrib_mask)          \
do {								\
   if (MESA_VERBOSE & VERBOSE_STATE)				\
      _mesa_debug(ctx, "FLUSH_VERTICES in %s\n", __func__);	\
   if (ctx->Driver.NeedFlush & FLUSH_STORED_VERTICES)		\
      vbo_exec_FlushVertices(ctx, FLUSH_STORED_VERTICES);	\
   ctx->NewState |= newstate;					\
   ctx->PopAttribState |= pop_attrib_mask;                      \
} while (0)
```

同一個 `GL_ALPHA_TEST` case 又以 `ST_SET_STATES` 直接將 `DriverFlags.NewAlphaTest` 合併到 `NewDriverState`。 這兩個寫入分屬不同層。 `_NEW_COLOR` 與 `_NEW_FF_FRAG_PROGRAM` 描述 Mesa core derived-state dependency

`NewAlphaTest` 是 State Tracker 初始化後依 driver 能力配置的 atom set，描述哪些 Gallium-facing states 必須重建。 有些 API state 只需要其中一層，有些兩層都需要

若 capability 不屬於任何合法 case，控制流程會到函式尾端的共同 error 路徑。 它只記錄 `GL_INVALID_ENUM`，不做 state write。 `switch` 內的驗證直接保護 mutation 邊界

以下程式碼來自 [Mesa: src/mesa/main/enable.c:1429](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/enable.c#L1429-1437) 的 `_mesa_set_enable()` error tail。 Tail 可觀察所有合法 `switch` cases 在完成自己的 mutation 後回傳，`default` 唯一會落到 `invalid_enum_error`，以 `state` 選 Enable／Disable 訊息並呼叫 `_mesa_error()`，不寫任何 state 欄位：

```c
void
_mesa_set_enable(struct gl_context *ctx, GLenum cap, GLboolean state)
{
   switch (cap) {
      ...
      default:
         goto invalid_enum_error;
   }
   return;

invalid_enum_error:
   _mesa_error(ctx, GL_INVALID_ENUM, "gl%s(%s)",
               state ? "Enable" : "Disable", _mesa_enum_to_string(cap));
}
```

合法 capability case 都在 `switch` 內完成 mutation 後 `return`，只有 `default` 會跳到 `invalid_enum_error`。 該 label 只依 `state` 組合 Enable／Disable 訊息並呼叫 `_mesa_error()`，沒有 canonical-state write 或 dirty-bit assignment

不同 capability 會標記不同的 dependency。 例如 blend enable 會更新 per-buffer mask、draw-out-of-order eligibility 與 valid-to-render cache。 clip-distance enable 則依 profile 決定是否標記 transform derived state。 各 case 共用的是「驗證、flush 舊 work、標記 dependency 與寫入 canonical state」的 ordering

```callgraph
Mesa OpenGL frontend：glEnable mutation 邊界
=================================================
[Mesa: src/mesa/main/enable.c:1440] _mesa_Enable(cap)
  │
  │  GET_CURRENT_CONTEXT(ctx);
  ↓
[Mesa: src/mesa/main/enable.c:483] _mesa_set_enable(ctx, cap, GL_TRUE)
  │
  ├─ case GL_ALPHA_TEST
  │    ├─ profile 不是 desktop compatibility 且不是 GLES1：goto invalid_enum_error
  │    ├─ ctx->Color.AlphaEnabled == GL_TRUE：return
  │    └─ FLUSH_VERTICES(...); NewDriverState |= NewAlphaTest; AlphaEnabled = GL_TRUE
  │         // 這個 case 先做 profile legality gate，再比對 current value
  ├─ 其他合法 case
  │    ├─ 依各 capability 的 extension／profile 與 value 條件驗證
  │    └─ [Mesa: src/mesa/main/context.h:172] FLUSH_VERTICES(ctx, newstate, mask)
  │         ctx->NewState |= newstate;
  │         ctx->NewDriverState |= driver_atom_bits;
  │         authoritative_field = GL_TRUE;
  └─ default
       └─ goto invalid_enum_error
          _mesa_error(ctx, GL_INVALID_ENUM, ...);
          // 結果：error 路徑回傳時沒有 state mutation
```

#### OpenGL error state 與單一 sticky slot

Setter 驗證失敗後，application 需要由 `glGetError()` 觀察錯誤，但連續失敗又不能無限制累積 object。 需要讀 `ErrorValue`、`_mesa_error()` 與 `_mesa_GetError()` 的條件寫入和清除順序，才能判定哪個 enum 可見、何時能記錄下一個 error，以及偵錯訊息為何是另一條輸出路徑

此固定版本的 Mesa core 保存 `ErrorValue` 單一 sticky slot，另有兩個欄位只用來壓縮重複偵錯訊息。 這三個欄位都是 per-context state，不在 share group，因此一個 context 的 error 不會由同一 share group 裡的另一個 context 取走

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:3541](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L3541-3550) 的 `struct gl_context` error 欄位，用來確認 `ErrorValue` 是 per-context sticky slot，而 `ErrorDebug*` 欄位只保存重複訊息的診斷資訊：

```c
   /* GL_EXT_framebuffer_object */
   struct gl_renderbuffer *CurrentRenderbuffer;

   GLenum16 ErrorValue;      /**< Last error code */

   /**
    * Recognize and silence repeated error debug messages in buggy apps.
    */
   const char *ErrorDebugFmtString;
   GLuint ErrorDebugCount;
```

`_mesa_error()` 同時服務兩個可觀察面。 依建置與執行期 debug setting，它可以把格式化訊息送到 log 或 debug-output machinery。 GL error state 則更簡單。 只有 `ErrorValue` 仍為 `GL_NO_ERROR` 時，新的 enum 才寫入。 在 application 呼叫 `glGetError()` 清掉它以前，後續 errors 不會覆蓋第一個 pending error

以下程式碼來自 [Mesa: src/mesa/main/errors.c:229](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/errors.c#L229-295) 的 `_mesa_error()`。 欄位寫入顯示 `do_output`／`do_log` predicates 只控制格式化診斷資訊，API-visible assignment 則受 `ctx->ErrorValue == GL_NO_ERROR` 保護，讓第一個 pending enum 留在 sticky slot 而不被後續 errors 覆蓋：

```c
void
_mesa_error( struct gl_context *ctx, GLenum error, const char *fmtString, ... )
{
   GLboolean do_output, do_log;
...
   if (do_output || do_log) {
      char s[MAX_DEBUG_MESSAGE_LENGTH], s2[MAX_DEBUG_MESSAGE_LENGTH];
      int len;
      va_list args;
...
   }

   /* Set the GL context error state for glGetError. */
   if (ctx->ErrorValue == GL_NO_ERROR)
      ctx->ErrorValue = error;
}
```

因此偵錯訊息串流與 `glGetError()` 結果不能互相替代。 偵錯路徑可以記錄多次、附帶文字與 severity。 API error slot 只保留一個 enum。 `ErrorDebugFmtString` 與 `ErrorDebugCount` 是用來避免 terminal 重複輸出的診斷記錄，不是額外的 GL errors

`_mesa_GetError()` 讀出 slot 後一律重設為 `GL_NO_ERROR`，下一個 error 才能被保存。 No-error context 對可觀察值再加一層 contract：除了 `GL_OUT_OF_MEMORY`，讀出值會轉成 `GL_NO_ERROR`。 Internal sticky slot 仍可服務 Mesa 內部流程，application 看到的則是 no-error API 規定的結果

以下程式碼來自 [Mesa: src/mesa/main/getstring.c:376](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/getstring.c#L376-402) 的 `_mesa_GetError()`。 Local `e` 先 snapshot `ErrorValue`，no-error context 將非 `GL_OUT_OF_MEMORY` 值改成 `GL_NO_ERROR`，common tail 再無條件清掉 `ErrorValue`／`ErrorDebugCount`，並回傳這次可觀察的單一結果：

```c
GLenum GLAPIENTRY
_mesa_GetError( void )
{
   GET_CURRENT_CONTEXT(ctx);
   GLenum e = ctx->ErrorValue;
   ASSERT_OUTSIDE_BEGIN_END_WITH_RETVAL(ctx, 0);
...
   if (_mesa_is_no_error_enabled(ctx) && e != GL_OUT_OF_MEMORY) {
      e = GL_NO_ERROR;
   }

   ctx->ErrorValue = (GLenum) GL_NO_ERROR;
   ctx->ErrorDebugCount = 0;
   return e;
}
```

`e` 先保存原本的 `ErrorValue`，no-error 分支只保留 `GL_OUT_OF_MEMORY`，接著 common tail 無條件清空 `ErrorValue` 與 `ErrorDebugCount`。 所以一次 `_mesa_GetError()` 最多回傳 sticky slot 中的一個 enum，並在回傳前讓下一個 error 可以進入同一欄位

```callgraph
Mesa OpenGL frontend：sticky OpenGL error slot
=================================================
[Mesa: src/mesa/main/errors.c:229] _mesa_error(ctx, error, fmt, ...)
  │
  ├─ if (ctx->ErrorValue == GL_NO_ERROR)
  │    └─ ctx->ErrorValue = error;
  │       // 第一個 pending enum 成為 glGetError 可觀察結果
  └─ else
       └─ 保留既有 ErrorValue
          // 後續訊息仍可進偵錯／log 路徑，但不覆蓋 sticky slot
  ↓
[Mesa: src/mesa/main/getstring.c:376] _mesa_GetError()
  │
  │  e = ctx->ErrorValue;
  │
  ├─ if (_mesa_is_no_error_enabled(ctx) && e != GL_OUT_OF_MEMORY)
  │    └─ e = GL_NO_ERROR;
  └─ ctx->ErrorValue = GL_NO_ERROR; ctx->ErrorDebugCount = 0;
       return e;
       // 結果：讀取後 slot 清空，下一個 error 才能成為 pending value
```

#### No-error context 是建立時選擇的入口與驗證 contract

建立 context 的呼叫端可以選 no-error contract，之後同一個 draw 或 clear 可能走較短的驗證路徑。 需要追 `_mesa_initialize_context()` 寫入的 flag、dispatch 選擇與 shared helper 的 flag 分支，才能分清「略過 API error checks」和「仍須建立執行所需的 state」這兩種工作

`_mesa_initialize_context()` 直接接收 `bool no_error`。 建立 context 時若這個值成立，就把 `GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR` 寫進 context constants。 後續 helper 只讀這個 flag，沒有 API setter 把既有 context 在 error 與 no-error modes 之間來回切換

以下程式碼來自 [Mesa: src/mesa/main/context.c:956](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L956-963) 與 [Mesa: src/mesa/main/context.c:1027](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1027-1035) 的 `_mesa_initialize_context()`，用來確認 no-error choice 寫入哪個持久欄位。 `no_error` 成立時，context 公布前會將 `GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR` OR 進 `Const.ContextFlags`，後續入口選擇與驗證 helpers 都讀這個 bit：

```c
GLboolean
_mesa_initialize_context(struct gl_context *ctx,
                         gl_api api,
                         bool no_error,
                         const struct gl_config *visual,
                         struct gl_context *share_list,
                         const struct dd_function_table *driverFunctions,
                         const struct st_config_options *options)
{
...
   if (no_error)
      ctx->Const.ContextFlags |= GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR;
...
}
```

`no_error` 是 context 建立參數，成立時將 `GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR` 寫入長期的 `ctx->Const.ContextFlags`。 這項 assignment 發生在 context 對 application 可用之前，後續入口與驗證 helper 共用同一個 bit

以下程式碼來自 [`Mesa: src/mesa/main/context.h:382`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.h#L382-393) 的 `_mesa_is_gles32_compatible()` 與 [`Mesa: src/mesa/main/context.h:389`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.h#L389-393) 的 `_mesa_is_no_error_enabled()`，用來查看 no-error helper 如何從 `ContextFlags` 取回建立時選擇：

```c
static inline bool
_mesa_is_gles32_compatible(const struct gl_context *ctx)
{
   return _mesa_is_gles32(ctx) || _mesa_has_ARB_ES3_2_compatibility(ctx);
}


static inline bool
_mesa_is_no_error_enabled(const struct gl_context *ctx)
{
   return ctx->Const.ContextFlags & GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR;
}
```

入口 table generator 會針對宣告有 no-error variant 的 API，依 `_mesa_is_no_error_enabled(ctx)` 選一般函式或 `_no_error` 函式。 [Mesa: src/mesa/glapi/glapi/gen/api_exec_init.py:94](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/glapi/glapi/gen/api_exec_init.py#L94-126) 這使驗證 contract 能在 dispatch setup 時下沉到不同入口，而不必讓每個公開 wrapper 都重做相同分支

此版本也保留 shared 實作的形式。 `Clear` 與 `ReadPixels` 的一般版和 no-error 版會將不同布林值傳給共同 helper。 `DrawArrays` 則在 common 入口內以 context flag 跳過 `_mesa_validate_DrawArrays()`

no-error 路徑仍可保留執行 operation 所需的分支，也必須安全處理實作自己需要的資料。 application 承諾不送出會產生一般 GL 驗證 error 的 inputs，Mesa 因而可以省略規格要求的 checks 與 error recording。 配置失敗、必要的 internal bookkeeping 與真正執行 operation 所需的 derived state 仍可能存在

這一點對後面的 draw 路徑很重要。 no-error 可以跳過 `mode`、negative count 與跨 object 的合法性驗證，但仍要在 draw 前把 dirty Mesa core state 化為 derived state，也仍要跑 State Tracker atoms。 驗證 contract 與 state materialization 是兩件不同的工作

```callgraph
Mesa OpenGL frontend：no-error contract 選擇
=================================================
[Mesa: src/mesa/main/context.c:956] _mesa_initialize_context(..., no_error, ...)
  │
  ├─ if (no_error)
  │    └─ ctx->Const.ContextFlags |= GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR;
  └─ else
       └─ ContextFlags 不加入 no-error bit
  ↓
[Mesa: src/mesa/main/context.h:389] _mesa_is_no_error_enabled(ctx)
  │
  └─ return ctx->Const.ContextFlags & GL_CONTEXT_FLAG_NO_ERROR_BIT_KHR;
       // dispatch setup 與 shared 入口都讀同一個建立時決策
  ↓
[Mesa: src/mesa/main/draw.c:1364] _mesa_DrawArrays(mode, start, count)
  │
  ├─ if (!_mesa_is_no_error_enabled(ctx) &&
  │       !_mesa_validate_DrawArrays(ctx, mode, count))
  │    └─ return
  └─ no-error／驗證成功
       └─ _mesa_draw_arrays(...)
          // 結果：略過 API legality checks，不略過 derived／driver state materialization
```

### Dirty state 與 derived state

Setter 已把 authoritative 欄位改好，draw 前卻仍缺少 Mesa core 可以直接使用的 derived values。 這一節先追 `NewState` 如何驅動 derived-state update，再看 valid-to-render cache 如何保存跨 object 驗證的結果。 更新完成後，Mesa core 會把仍需轉成 Gallium state 的變更交給 `NewDriverState`，其消費方式留到 State Tracker 章展開

#### `NewState` 與 `NewDriverState`

State setter 已留下 dirty information，現在要先分清 Mesa core 與 State Tracker 各自等待處理的是哪一份。 `NewState` 保存 core derived-state dependencies。 `NewDriverState` 則保存 core 完成更新後，仍要交給 State Tracker 轉成 Gallium state 的項目

`NewState` 是由 `_NEW_*` flags 組成的 `GLbitfield`，回答 Mesa core 的 derived values 是否可能過期。 `NewDriverState` 則是由 `ST_NEW_*` atom indexes 組成的 `st_state_bitset`，回答 State Tracker 尚有哪些 Gallium-facing state update 函式沒執行

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:3552](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L3552-3561) 的 `gl_context` dirty 欄位。 欄位顯示 `NewState` 與 `PopAttribState` 使用 core `_NEW_*` bit space，`NewDriverState` 使用 State Tracker atom bitset，`DriverFlags` 則保存各種 API mutation 應轉成哪些 driver bits：

```c
   /* GL_ARB_debug_output/GL_KHR_debug */
   simple_mtx_t DebugMutex;
   struct gl_debug_state *Debug;

   GLenum16 RenderMode;      /**< either GL_RENDER, GL_SELECT, GL_FEEDBACK */
   GLbitfield NewState;      /**< bitwise-or of _NEW_* flags */
   GLbitfield PopAttribState; /**< Updated state since glPushAttrib */
   st_state_bitset NewDriverState;  /**< bitwise-or of flags from DriverFlags */

   struct gl_driver_flags DriverFlags;
```

API setter 可以直接標記其中一層或兩層。 前面的 alpha-test case 以 `FLUSH_VERTICES` 加入 `_NEW_COLOR | _NEW_FF_FRAG_PROGRAM`，又以 `ST_SET_STATES` 加入 driver-specific atom set。 framebuffer binding 之類的變更則會先留下 `_NEW_BUFFERS`，等 Mesa core 更新 framebuffer derived 欄位後，再由 `st_invalidate_state()` 把影響交給 State Tracker

這種延後展開保留 dependency information。 多個 setters 在下一次 draw 前連續執行時，bits 只會 OR 在一起。 後續 update 只需做一次，不必每次 API 呼叫都重新建立相同 CSO。 如果一項 state write 會影響另一項 derived state，core update 還能追加新的 `_NEW_*` bits，再一次性轉給 State Tracker

`NewDriverState` 保存待處理的 State Tracker bits，不保存 submitted commands。 bit 被設起來只代表對應的 Gallium-facing state 可能已經過期。 同樣地，`NewState == 0` 只表示 Mesa core derived state 目前一致。 後續如何從 `NewDriverState` 選出本次 operation 需要的 atoms，會在「Mesa State Tracker」章沿 `st_invalidate_state()` 與 `st_validate_state()` 展開

#### Mesa core derived state

Draw 發現 `NewState != 0` 時，必須把 framebuffer、texture、program 與 fixed-function dependencies 依正確次序重算，還要把改變翻成 State Tracker bits。 需要讀 `_mesa_update_state_locked()` 的 local bitset 擴張、program dependency 與 `st_invalidate_state()` handoff，才能知道 `NewState` 清零時哪些 driver atoms 仍待處理

`_mesa_update_state_locked()` 先 snapshot 目前 bits，建立一組需要 core computation 的 `checked_states`。 若只有不在這組裡的 bits，控制流程可以直接到 common tail。 若 `_NEW_BUFFERS` dirty，則先更新 read 與 draw framebuffer，讓 attachment-derived width、height、visual 與 routing 恢復一致

以下程式碼來自 [Mesa: src/mesa/main/state.c:542](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/state.c#L542-575) 的 `_mesa_update_state_locked()` prologue。 Prologue 可觀察函式 snapshot `ctx->NewState`，以 `checked_states` 篩掉不需 core computation 的 bits，並在 `_NEW_BUFFERS` 成立時先更新 read／draw framebuffer derived 欄位，讓後續 dependencies 看到一致 attachment state：

```c
void
_mesa_update_state_locked( struct gl_context *ctx )
{
   GLbitfield new_state = ctx->NewState;
   GLbitfield new_prog_state = 0x0;
   const GLbitfield checked_states =
      _NEW_BUFFERS | _NEW_MODELVIEW | _NEW_PROJECTION | _NEW_TEXTURE_MATRIX |
      _NEW_TEXTURE_OBJECT | _NEW_TEXTURE_STATE | _NEW_PROGRAM |
      _NEW_LIGHT_CONSTANTS | _NEW_POINT | _NEW_FF_VERT_PROGRAM |
      _NEW_FF_FRAG_PROGRAM | _NEW_TNL_SPACES;
...
   if (!(new_state & checked_states))
      goto out;
...
   if (new_state & _NEW_BUFFERS)
      _mesa_update_framebuffer(ctx, ctx->ReadBuffer, ctx->DrawBuffer);
...
}
```

compatibility 路徑還會依 bits 更新 modelview/projection composition、texture matrices、texture state、lighting spaces，以及由 fixed-function state 產生的 programs。 core-style 路徑省略 legacy calculations，但 `_NEW_TEXTURE_OBJECT` 與 `_NEW_PROGRAM` 仍會更新 texture state 與目前 stage programs。 `_NEW_*` 因此編碼 dependency categories

以下程式碼來自 [Mesa: src/mesa/main/state.c:577](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/state.c#L577-636) 的 `_mesa_update_state_locked()` dependency 分支。 分支顯示 compatibility contexts 依 modelview、projection、texture matrix、lighting 與 fixed-function program bits 執行對應 updates。 core-style contexts 仍處理 texture／program dependencies，並將新產生的 program bits 收進 `new_prog_state`：

```c
void
_mesa_update_state_locked(struct gl_context *ctx)
{
...
   if (_mesa_is_desktop_gl_compat(ctx) ||
       _mesa_is_gles1(ctx)) {
      /* Update derived state. */
      if (new_state & (_NEW_MODELVIEW|_NEW_PROJECTION))
         _mesa_update_modelview_project( ctx, new_state );

      if (new_state & _NEW_TEXTURE_MATRIX)
         new_state |= _mesa_update_texture_matrices(ctx);

      if (new_state & (_NEW_TEXTURE_OBJECT | _NEW_TEXTURE_STATE | _NEW_PROGRAM))
         new_state |= _mesa_update_texture_state(ctx);
...
   } else {
      /* GL Core and GLES 2/3 contexts */
      if (new_state & (_NEW_TEXTURE_OBJECT | _NEW_PROGRAM))
         _mesa_update_texture_state(ctx);

      if (new_state & _NEW_PROGRAM)
         update_program(ctx);
   }
...
}
```

program selection 或 program constants update 可能產生新的 dependency，`new_prog_state` 因而在 tail OR 回 `NewState`。 接著 `st_invalidate_state(ctx)` 讀取仍存在的 core bits，將它們翻成 `NewDriverState` atoms。 最後才把 `NewState` 歸零。 ordering 不能反過來，否則 State Tracker 會看不到這一輪 core dirtiness

以下程式碼來自 [Mesa: src/mesa/main/state.c:638](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/state.c#L638-662) 的 `_mesa_update_state_locked()` tail 與 `_mesa_update_state()` wrapper。 提交順序顯示 program constants 產生的 bits 先 OR 回 `NewState`，`st_invalidate_state()` 接著翻成 driver atoms，最後才清零。 outer wrapper 則在整段計算期間鎖住 shared texture objects：

```c
void
_mesa_update_state_locked(struct gl_context *ctx)
{
...
 out:
   new_prog_state |= update_program_constants(ctx);

   ctx->NewState |= new_prog_state;
...
   st_invalidate_state(ctx);
   ctx->NewState = 0;
}

void
_mesa_update_state( struct gl_context *ctx )
{
   _mesa_lock_context_textures(ctx);
   _mesa_update_state_locked(ctx);
   _mesa_unlock_context_textures(ctx);
}
```

outer `_mesa_update_state()` 在計算期間鎖住 context textures。 texture objects 可位於 share group，而 texture completeness 與 program sampling dependencies 會影響 current context 的 derived state。 lock 保護計算 snapshot，並不把 `NewState` 變成 shared 欄位。 每個 context 仍保有自己的 dirty bits 與 derived bindings

clear 有較窄的 `_mesa_update_clear_state()`。 它只在 `_NEW_BUFFERS` dirty 時更新 framebuffer，讓 clear 所需的 bounds 與 surfaces 有效，然後只清掉 `_NEW_BUFFERS`。 其他 core dirty bits 可留給後續 draw。 這正是 operation-specific 驗證的另一個例子

```callgraph
Mesa core：derived state 與 State Tracker handoff
=================================================
[Mesa: src/mesa/main/state.c:638] _mesa_update_state(ctx)
  │
  │  _mesa_lock_context_textures(ctx);
  │  // shared texture state 在 derived calculation 期間保持穩定
  ↓
[Mesa: src/mesa/main/state.c:542] _mesa_update_state_locked(ctx)
  │
  │  new_state = ctx->NewState;
  │
  ├─ if (!(new_state & checked_states))
  │    └─ goto out
  ├─ if (new_state & _NEW_BUFFERS)
  │    └─ _mesa_update_framebuffer(ctx, ctx->ReadBuffer, ctx->DrawBuffer);
  └─ program／texture updates
       └─ ctx->NewState |= new_prog_state;
          // 新 dependency 在交給 State Tracker 前併回 core bits
  ↓
[Mesa: src/mesa/state_tracker/st_context.c:100] st_invalidate_state(ctx)
  │
  │  // handoff：把這輪 core dependencies 交給 State Tracker
  ↓
ctx->NewState = 0;
  │
  └─ core derived state 已一致，Gallium-facing updates 保留在 NewDriverState
```

#### Cached valid-to-render state

Mesa core derived state 更新後，DrawArrays 還要快速判斷 current framebuffer、program、sampler、transform feedback 與 VAO 組合是否允許指定 primitive。 需要讀 `_mesa_update_valid_to_render_state()` 的提前回傳和 `valid_prim_mode_custom()` 的 bit tests，才能知道 cache 何時寫入成功 mask，以及失敗時為何回報特定 `DrawGLError`

`gl_context` 保存 supported mask、兩個 current-valid masks，以及失敗時應回報的 `DrawGLError`，避免每次 draw 都重走完整 object graph

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:3318](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L3318-3345) 的 `gl_context` draw-validity cache。 欄位顯示 `SupportedPrimMask` 是 context capability 上限，`ValidPrimMask`／`ValidPrimMaskIndexed` 分別保存 non-indexed／indexed draw 的 current-state legality，`DrawGLError` 保存 invalid state 對應的 error enum：

```c
   GLbitfield SupportedPrimMask;

   /**
    * Bitmask of valid primitive types depending on current states (such as
    * shaders). This is 0 if the current states should result in
    * GL_INVALID_OPERATION in draw calls.
    */
   GLbitfield ValidPrimMask;

   GLenum16 DrawGLError; /**< GL error to return from draw calls */

   /**
    * Same as ValidPrimMask, but should be applied to glDrawElements*.
    */
   GLbitfield ValidPrimMaskIndexed;
...
   bool DrawPixValid;
```

`SupportedPrimMask` 描述 context type、version 與 extensions 的靜態上限。 `ValidPrimMask` 再套用 current state，服務 non-indexed draw。 `ValidPrimMaskIndexed` 另外承載 indexed draw 在 transform feedback 等情境下的限制。 `DrawPixValid` 給較舊的 pixel operations 使用。 這些都是 derived cache，不能由 application 直接設定

`_mesa_update_valid_to_render_state()` 先處理 no-error context。 no-error contract 讓兩個 valid masks 直接等於 supported mask，略過跨 object legality checks。 一般 context 則先把 masks 清成零，預設 error 為 `GL_INVALID_OPERATION`。 若 draw framebuffer 不完整，error 改成 `GL_INVALID_FRAMEBUFFER_OPERATION` 並回傳。 每次提前回傳都讓零 mask 保留下來

以下程式碼來自 [Mesa: src/mesa/main/draw_validate.c:41](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw_validate.c#L41-79) 的 `_mesa_update_valid_to_render_state()` early 分支。 Early exits 顯示 local `mask` 從 `SupportedPrimMask` 開始，no-error context 直接寫入兩個 valid masks。 一般 context 先檢查 framebuffer、shader pipeline 與 draw-pixel legality，失敗時清空 masks 並設定 `DrawGLError`：

```c
void
_mesa_update_valid_to_render_state(struct gl_context *ctx)
{
   struct gl_pipeline_object *shader = ctx->_Shader;
   unsigned mask = ctx->SupportedPrimMask;
   bool drawpix_valid = true;

   if (_mesa_is_no_error_enabled(ctx)) {
      ctx->ValidPrimMask = mask;
      ctx->ValidPrimMaskIndexed = mask;
      ctx->DrawPixValid = drawpix_valid;
      return;
   }

   /* Start with an empty mask and set this to the trimmed mask at the end. */
   ctx->ValidPrimMask = 0;
   ctx->ValidPrimMaskIndexed = 0;
   ctx->DrawPixValid = false;
...
   ctx->DrawGLError = GL_INVALID_OPERATION;

   if (!ctx->DrawBuffer ||
       ctx->DrawBuffer->_Status != GL_FRAMEBUFFER_COMPLETE_EXT) {
      ctx->DrawGLError = GL_INVALID_FRAMEBUFFER_OPERATION;
      return;
   }
...
}
```

經過共同 conditions 後，函式依 shader stages、profile、polygon modes、transform feedback 及 tessellation 等 state 修剪 local `mask`。 到達 non-indexed 成功點時才寫 `ValidPrimMask`。 indexed draw 還有額外規則，全部驗證成功後才寫 `ValidPrimMaskIndexed`。 這個分段讓 DrawArrays 與 DrawElements 共用昂貴 checks，又保存兩者的差異

以下程式碼來自 [Mesa: src/mesa/main/draw_validate.c:507](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw_validate.c#L507-540) 的 `_mesa_update_valid_to_render_state()` 成功收尾。 Tail 顯示 common checks 完成後先提交 `ValidPrimMask`，GLES3 transform-feedback restriction 仍可讓 indexed 路徑提前回傳，只有額外規則也符合時才寫入 `ValidPrimMaskIndexed`：

```c
void
_mesa_update_valid_to_render_state(struct gl_context *ctx)
{
...
   /* Non-indexed draws are valid after this point. */
   ctx->ValidPrimMask = mask;
...
   if (_mesa_is_gles3(ctx) &&
       !_mesa_has_OES_geometry_shader(ctx) &&
       _mesa_is_xfb_active_and_unpaused(ctx))
      return;

   ctx->ValidPrimMaskIndexed = mask;
}
```

實際 draw parameter 驗證只需以 `mode` 對 cached mask 做 bit test。 mode 不在 `SupportedPrimMask` 時屬於 invalid enum。 mode 本身受支援、但被 current state 排除時，則回傳先前 cache 保存的 `DrawGLError`。 debug 建置會重新執行 cache update 並 assert 結果不變，用來抓漏掉 cache invalidation 的 setter

以下程式碼來自 [Mesa: src/mesa/main/draw.c:180](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L180-215) 的 `valid_prim_mode_custom()`，用來確認 fast 路徑與兩種失敗結果。 Fast 路徑只以 `mode` bit test 呼叫端提供的 valid mask。 失敗再區分 mode 是否超出 `SupportedPrimMask`，前者回 `GL_INVALID_ENUM`，後者回 cached `DrawGLError`，debug 建置另會重算 cache 並 assert 一致：

```c
static GLenum
valid_prim_mode_custom(struct gl_context *ctx, GLenum mode,
                       GLbitfield valid_prim_mask)
{
...
   /* All primitive type enums are less than 32, so we can use the shift. */
   if (mode >= 32 || !((1u << mode) & valid_prim_mask)) {
...
      return mode >= 32 || !((1u << mode) & ctx->SupportedPrimMask) ?
               GL_INVALID_ENUM : ctx->DrawGLError;
   }

   return GL_NO_ERROR;
}
...
GLenum
_mesa_valid_prim_mode(struct gl_context *ctx, GLenum mode)
{
   return valid_prim_mode_custom(ctx, mode, ctx->ValidPrimMask);
}
```

cache correctness 依賴所有相關 state setters 在變更時呼叫 `_mesa_update_valid_to_render_state()`。 前面的 blend-enable case 就在修改 mask 後更新 cache。 framebuffer、program pipeline、shader 與其他影響 draw legality 的路徑也各自觸發 update

它與 `NewState` 的 lazy recomputation 並存。 legality cache 可以在 setter 時立即更新，昂貴的 Gallium state materialization 則延到 consumption point

```callgraph
Mesa core：valid-to-render cache 與 draw-time bit test
=================================================
[Mesa: src/mesa/main/draw_validate.c:41] _mesa_update_valid_to_render_state(ctx)
  │
  ├─ if (_mesa_is_no_error_enabled(ctx))
  │    ├─ ctx->ValidPrimMask = ctx->SupportedPrimMask;
  │    └─ ctx->ValidPrimMaskIndexed = ctx->SupportedPrimMask; return;
  │       // no-error contract 採 capability ceiling，不跑跨 object legality checks
  └─ ordinary context
       ├─ ctx->ValidPrimMask = 0; ctx->ValidPrimMaskIndexed = 0;
       ├─ ctx->DrawGLError = GL_INVALID_OPERATION;
       └─ if (ctx->DrawBuffer->_Status != GL_FRAMEBUFFER_COMPLETE_EXT)
            └─ ctx->DrawGLError = GL_INVALID_FRAMEBUFFER_OPERATION; return;
  │
  └─ 所有 checks 成功
       ├─ ctx->ValidPrimMask = mask;
       └─ ctx->ValidPrimMaskIndexed = mask;
  ↓
[Mesa: src/mesa/main/draw.c:180] valid_prim_mode_custom(ctx, mode, valid_mask)
  │
  ├─ if (!(ctx->SupportedPrimMask & BITFIELD_BIT(mode)))
  │    └─ return GL_INVALID_ENUM;
  ├─ if (!(valid_mask & BITFIELD_BIT(mode)))
  │    └─ return ctx->DrawGLError;
  └─ return GL_NO_ERROR
       // 結果：draw 以單次 cached bit test 取得跨 object 的驗證結果
```

### `glDrawArrays()` 從 API 驗證到 State Tracker 交接

State caches 已可供消費，application 現在送出一筆實際 `glDrawArrays()`。 需要按公開入口、argument 驗證、`pipe_draw_info` 建立與 State Tracker handoff 的順序閱讀，才能把合法 no-op、GL error、argument conversion 與成功交接分成不同終點

#### 公開入口與驗證

公開入口手上只有 `mode`、`start`、`count` 與 current `gl_context`，必須先處理 buffered vertices，再判斷一般/no-error 驗證分支。 讀 `_mesa_DrawArrays()`、`validate_draw_arrays()` 與 `_mesa_validate_DrawArrays()`，才能定位 negative count、invalid primitive、transform-feedback quota 與 zero-count no-op 各在哪裡回傳

`_mesa_DrawArrays()` 先以 `FLUSH_FOR_DRAW` 處理 VBO 路徑保存的 vertices 或 current attributes，再依 vertex-processing mode 與 draw VAO 設定 inputs。 若 `NewState` 非零，它會在 argument 驗證前更新 core derived state，因而連最後驗證失敗的 draw 也可能先完成 state update

以下程式碼來自 [Mesa: src/mesa/main/draw.c:1364](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L1364-1390) 的 `_mesa_DrawArrays()`。 入口執行順序顯示函式先執行 `FLUSH_FOR_DRAW()`、更新 varying inputs，並在 `NewState` 非零時 materialize core derived state。 一般 context 接著呼叫驗證 wrapper，檢查成功才進 `_mesa_draw_arrays()`，no-error 入口則可略過 API checks：

```c
void GLAPIENTRY
_mesa_DrawArrays(GLenum mode, GLint start, GLsizei count)
{
   GET_CURRENT_CONTEXT(ctx);
   FLUSH_FOR_DRAW(ctx);

   _mesa_set_varying_vp_inputs(ctx, ctx->VertexProgram._VPModeInputFilter &
                               ctx->Array._DrawVAO->_EnabledWithMapMode);
   if (ctx->NewState)
      _mesa_update_state(ctx);

   if (!_mesa_is_no_error_enabled(ctx) &&
       !_mesa_validate_DrawArrays(ctx, mode, count))
      return;
...
   _mesa_draw_arrays(ctx, mode, start, count, 1, 0);
...
}
```

`FLUSH_FOR_DRAW` 依 `Driver.NeedFlush` 處理 stored vertices 或 current attributes，不標記 API state mutation。 `_AllowDrawOutOfOrder` 成立時只更新 current values，否則處理完整 pending flush mask

以下程式碼來自 [Mesa: src/mesa/main/context.h:211](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.h#L211-231) 的 `FLUSH_FOR_DRAW` 巨集。 Macro 分支顯示 `Driver.NeedFlush` 為零時不做事。 允許 out-of-order draw 時只處理 `FLUSH_UPDATE_CURRENT`，其他情況則將完整 pending mask 交給 `vbo_exec_FlushVertices()`，而且不修改 `NewState`：

```c
#define FLUSH_FOR_DRAW(ctx)                                     \
do {                                                            \
   if (MESA_VERBOSE & VERBOSE_STATE)                            \
      _mesa_debug(ctx, "FLUSH_FOR_DRAW in %s\n", __func__);     \
   if (ctx->Driver.NeedFlush) {                                 \
      if (ctx->_AllowDrawOutOfOrder) {                          \
          if (ctx->Driver.NeedFlush & FLUSH_UPDATE_CURRENT)     \
             vbo_exec_FlushVertices(ctx, FLUSH_UPDATE_CURRENT); \
      } else {                                                  \
         vbo_exec_FlushVertices(ctx, ctx->Driver.NeedFlush);    \
      }                                                         \
   }                                                            \
} while (0)
```

一般 context 的 `validate_draw_arrays()` 先拒絕負的 count，再查 cached `ValidPrimMask`。 若 transform feedback 追蹤剩餘 primitives，它也會檢查並扣除本次 draw 的 quota

以下程式碼來自 [Mesa: src/mesa/main/draw.c:463](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L463-484) 的 `validate_draw_arrays()`。 驗證順序可追蹤 negative count／instance count 先回 `GL_INVALID_VALUE`，`_mesa_valid_prim_mode()` 再區分 unsupported enum 與 current-state error，transform-feedback quota check 最後才接受並扣除本次 primitive count：

```c
static GLenum
validate_draw_arrays(struct gl_context *ctx,
                     GLenum mode, GLsizei count, GLsizei numInstances)
{
   if (count < 0 || numInstances < 0)
      return GL_INVALID_VALUE;

   GLenum error = _mesa_valid_prim_mode(ctx, mode);
   if (error)
      return error;

   if (need_xfb_remaining_prims_check(ctx)) {
      struct gl_transform_feedback_object *xfb_obj
         = ctx->TransformFeedback.CurrentObject;
      size_t prim_count = count_tessellated_primitives(mode, count, numInstances);
      if (xfb_obj->GlesRemainingPrims < prim_count)
         return GL_INVALID_OPERATION;

      xfb_obj->GlesRemainingPrims -= prim_count;
   }

   return GL_NO_ERROR;
}
```

wrapper 把非零 error 交給 `_mesa_error()`，再回傳布林值。 no-error context 會跳過這個處理 API contract 的 helper，此時尚未建立 `pipe_draw_info` 或呼叫 State Tracker atoms

以下程式碼來自 [Mesa: src/mesa/main/draw.c:487](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L487-501) 的 `_mesa_validate_DrawArrays()`，用來確認驗證 error 如何轉成 OpenGL error，以及 wrapper 的布林回傳值如何阻止不合法 draw。 `numInstances` 固定為 1，nonzero error 交給 `_mesa_error(ctx, ..., "glDrawArrays")`，並以 `!error` 回傳是否可進 draw 路徑。 此時尚未建立 Gallium descriptor 或更新 State Tracker atoms：

```c
static GLboolean
_mesa_validate_DrawArrays(struct gl_context *ctx, GLenum mode, GLsizei count)
{
   GLenum error = validate_draw_arrays(ctx, mode, count, 1);

   if (error)
      _mesa_error(ctx, error, "glDrawArrays");

   return !error;
}
```

zero count 是合法 no-op，但一般 context 仍先驗證 mode。 `_mesa_draw_arrays()` 才提前回傳，因此合法 no-op 不進入 State Tracker

```callgraph
Mesa core：glDrawArrays 公開入口與驗證
=================================================
[Mesa: src/mesa/main/draw.c:1364] _mesa_DrawArrays(mode, start, count)
  │
  │  GET_CURRENT_CONTEXT(ctx); FLUSH_FOR_DRAW(ctx);
  │  vbo_set_vertex_processing_mode(...); _mesa_set_varying_vp_inputs(...);
  │
  ├─ if (ctx->NewState)
  │    └─ _mesa_update_state(ctx);
  │       // argument 最後失敗時，core derived state 仍可能已更新
  ├─ if (!_mesa_is_no_error_enabled(ctx))
  │    ↓
  │  [Mesa: src/mesa/main/draw.c:487] _mesa_validate_DrawArrays(ctx, mode, count)
  │    ├─ count < 0／mode 不合法／transform-feedback quota 失敗
  │    │    └─ _mesa_error(ctx, error, ...); return GL_FALSE;
  │    └─ return GL_TRUE
  └─ no-error context：略過上述 API legality helper
  ↓
[Mesa: src/mesa/main/draw.c:1135] _mesa_draw_arrays(...)
  │
  ├─ if (!count || !numInstances) return;
  │    // 合法 zero-count no-op 不進 State Tracker
  └─ 建立 Gallium descriptors
       // 結果：只有 validated nonzero request 繼續到 draw handoff
```

#### 建立 Gallium draw info

驗證成功後，Mesa 還要把 OpenGL signature 轉成 Gallium 的 draw-wide descriptor 與一筆 range record。 讀 `_mesa_draw_arrays()` 的 zero-count 分支、`pipe_draw_info` assignments、`st_prepare_draw()` 與 `DrawGallium` invocation，才能確認 handoff 帶了哪些欄位，以及 callback 尚未代表 completion

non-indexed draw 以 `index_size = 0` 表示不取 element buffer。 `info.mode` 可直接保存 GL mode，因為 State Tracker 以 compile-time assertions 檢查 primitive enum 值一致

以下程式碼來自 [Mesa: src/mesa/main/draw.c:1135](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L1135-1174) 的 `_mesa_draw_arrays()` descriptor setup。 設定流程顯示 zero count／instances 是合法的提前回傳條件，其餘呼叫才初始化 `pipe_draw_info` 的 mode、index size、instance count、restart 與 draw-ID 欄位，並建立單筆 `draw.start`／`draw.count`：

```c
static void
_mesa_draw_arrays(struct gl_context *ctx, GLenum mode, GLint start,
                  GLsizei count, GLuint numInstances, GLuint baseInstance)
{
   /* Viewperf has many draws with count=0. Discarding them is faster than
    * processing them.
    */
   if (!count || !numInstances)
      return;
...
   struct pipe_draw_info info;
   struct pipe_draw_start_count_bias draw;

   info.mode = mode;
   info.index_size = 0;
   /* Packed section begin. */
   info.primitive_restart = false;
   info.has_user_indices = false;
   info.index_bounds_valid = true;
   info.increment_draw_id = false;
   info.was_line_loop = false;
   info.index_bias_varies = false;
   /* Packed section end. */
   info.start_instance = baseInstance;
   info.instance_count = numInstances;
   info.min_index = start;
   info.max_index = start + count - 1;

   draw.start = start;
   draw.count = count;
...
}
```

info 建好後，`ST_PIPELINE_RENDER_STATE_MASK` 產生 atom mask，`st_prepare_draw()` 消費必要 atoms，再經 `Driver.DrawGallium` 送出一筆非 indirect draw record

以下程式碼來自 [Mesa: src/mesa/main/draw.c:1172](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L1172-1183) 的 `_mesa_draw_arrays()` handoff tail。 交接順序顯示 `ST_PIPELINE_RENDER_STATE_MASK` 選出 rendering atoms，`st_prepare_draw()` 先 materialize state，`Driver.DrawGallium()` 再接收 `info`、`DrawID` 與一筆 draw range。 只有 debug flag 會在 callback 後額外 `_mesa_flush()`：

```c
static void
_mesa_draw_arrays(struct gl_context *ctx, GLenum mode, GLint start,
                  GLsizei count, GLuint numInstances, GLuint baseInstance)
{
...
   draw.start = start;
   draw.count = count;

   ST_PIPELINE_RENDER_STATE_MASK(mask);
   st_prepare_draw(ctx, mask);

   ctx->Driver.DrawGallium(ctx, &info, ctx->DrawID, NULL, &draw, 1);

   if (MESA_DEBUG_FLAGS & DEBUG_ALWAYS_FLUSH) {
      _mesa_flush(ctx);
   }
}
```

`DEBUG_ALWAYS_FLUSH` 只供診斷。 `DrawGallium` 建立 driver work，flush 負責 submission，finish 與 fences 負責將 completion 轉成呼叫端可觀察的結果

```callgraph
Mesa core／State Tracker：建立 draw descriptor
=================================================
[Mesa: src/mesa/main/draw.c:1135] _mesa_draw_arrays(ctx, mode, start, count, ...)
  │
  ├─ if (!count || !numInstances)
  │    └─ return
  └─ struct pipe_draw_info info = {0};
       info.mode = mode;
       info.index_size = 0;
       info.instance_count = numInstances;
       draw.start = start; draw.count = count;
       // handoff object 已從 GL signature 正規化為 Gallium descriptor + range
  ↓
[Mesa: src/mesa/state_tracker/st_draw.c:68] st_prepare_draw(ctx, mask)
  │
  │  // handoff：current context 與本次 rendering 所需的 state mask
  ↓
[Mesa: src/mesa/main/draw.c:1172] ctx->Driver.DrawGallium(...)
  │
  └─ info + draw + num_draws = 1 交給註冊的 State Tracker callback
       // 結果：frontend 已完成驗證與 argument conversion
```

### Clear、readback、flush 與 finish

同一個 context 除了 draw，還要處理不建立 vertex work 的 clear、把 framebuffer 內容讀回 CPU，以及推進或等待 pending work。 這裡先閱讀四種 operation 的 OpenGL 入口，確認 Mesa core 完成哪些驗證與 argument conversion、交給哪個 `st_*` 入口，以及 API 回傳提供哪一種同步保證

#### Clear 仍要驗證與 framebuffer state

Application 要清除 current draw framebuffer，手上只有 API mask 與 context state，沒有 vertex descriptor。 需要追 `clear()` 的驗證與 attachment-mask conversion，才能知道哪些 buffer bit 會因 write mask 或缺少 attachment 被移除，以及 Mesa core 最後把哪一組 attachment bits 交給 `st_Clear()`

common `clear()` 先呼叫 `FLUSH_VERTICES(ctx, 0, 0)`，讓 buffered vertices 保持在 clear 之前。 一般入口驗證 mask 與 accumulation buffer legality，no-error 入口則跳過這組 checks

若 `NewState` 非零，clear 使用較窄的 `_mesa_update_clear_state()`。 這個 helper 只更新 `_NEW_BUFFERS`，讓 framebuffer 尺寸、attachments 與 surfaces 有效，不先計算 draw shaders 或 vertex arrays。 隨後一般 context 檢查 draw FBO completeness

以下程式碼來自 [Mesa: src/mesa/main/clear.c:137](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/clear.c#L137-180) 的 `clear()` 驗證部分。 驗證路徑顯示入口先 flush buffered vertices。 一般 context 拒絕未知 mask bits 與 incomplete draw FBO，`NewState` 非零時先更新 derived state，合法 zero mask 則在進 State Tracker 前直接回傳：

```c
static ALWAYS_INLINE void
clear(struct gl_context *ctx, GLbitfield mask, bool no_error)
{
   FLUSH_VERTICES(ctx, 0, 0);

   if (!no_error) {
      if (mask & ~(GL_COLOR_BUFFER_BIT |
                   GL_DEPTH_BUFFER_BIT |
                   GL_STENCIL_BUFFER_BIT |
                   GL_ACCUM_BUFFER_BIT)) {
         _mesa_error( ctx, GL_INVALID_VALUE, "glClear(0x%x)", mask);
         return;
      }
...
   }

   if (ctx->NewState) {
      _mesa_update_clear_state( ctx );	/* update _Xmin, etc */
   }

   if (!no_error && ctx->DrawBuffer->_Status != GL_FRAMEBUFFER_COMPLETE_EXT) {
      _mesa_error(ctx, GL_INVALID_FRAMEBUFFER_OPERATION_EXT,
                  "glClear(incomplete framebuffer)");
      return;
   }
...
}
```

core 接著把 API color/depth/stencil bits 轉成實際 attachment mask。 disabled depth write 會移除 depth bit。 color routing 依 FBO 的 `_ColorDrawBufferIndexes` 與 per-buffer color write mask 決定。 沒有對應 attachment storage 的 depth、stencil 或 accumulation bit 也不會送到 State Tracker

以下程式碼來自 [Mesa: src/mesa/main/clear.c:188](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/clear.c#L188-225) 的 `clear()` attachment-mask conversion。 轉換迴圈顯示 disabled depth writes 移除 depth bit，color loop 以 `_ColorDrawBufferIndexes` 與 per-buffer write mask 建立 `bufferMask`，沒有對應 storage 的 depth／stencil／accum bits 也會被清掉，最後才呼叫 `st_Clear()`：

```c
static ALWAYS_INLINE void
clear(struct gl_context *ctx, GLbitfield mask, bool no_error)
{
...
      /* don't clear depth buffer if depth writing disabled */
      if (!ctx->Depth.Mask)
         mask &= ~GL_DEPTH_BUFFER_BIT;
...
      if (mask & GL_COLOR_BUFFER_BIT) {
         GLuint i;
         for (i = 0; i < ctx->DrawBuffer->_NumColorDrawBuffers; i++) {
            gl_buffer_index buf = ctx->DrawBuffer->_ColorDrawBufferIndexes[i];

            if (buf != BUFFER_NONE && color_buffer_writes_enabled(ctx, i)) {
               bufferMask |= 1 << buf;
            }
         }
      }
...
      st_Clear(ctx, bufferMask);
...
}
```

至此 Mesa core 已完成 clear 的 API 驗證，實際可寫入的 attachment mask 也已交給 `st_Clear()`。 State Tracker 如何選擇 `pipe->clear()` 或 quad-based clear，會在後面的 State Tracker 章展開

#### ReadPixels 的 format、packing、clipping 與 State Tracker handoff

Application 要將 read framebuffer 的矩形寫入 client memory 或 PBO，Mesa core 必須先處理 API format legality、pack layout、clipping 與 destination bounds。 讀 `read_pixels()` 的提前回傳、`clippedPacking` 副本與 `st_ReadPixels()` 呼叫，便能確認 State Tracker 收到的矩形與 pack state

`_mesa_ReadPixels()` 把 unlimited API form 轉給 `_mesa_ReadnPixelsARB()`，最後進共同 `read_pixels()`。 common 路徑先 flush buffered vertices，更新 pixel-transfer state，再在 `NewState` 非零時完成 Mesa core derived update。 一般 context 先拒絕 negative 尺寸與 incomplete read FBO

以下程式碼來自 [Mesa: src/mesa/main/readpix.c:1044](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/readpix.c#L1044-1073) 的 `read_pixels()` prologue。 Prologue 顯示函式先 flush vertices、更新 pixel-transfer state 與 pending core state，negative 尺寸在一般 context 產生 `GL_INVALID_VALUE`，zero width／height 則是合法的提前回傳條件，之後才選 read renderbuffer 並驗證 format／type：

```c
static ALWAYS_INLINE void
read_pixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format,
            GLenum type, GLsizei bufSize, GLvoid *pixels, bool no_error)
{
   GLenum err = GL_NO_ERROR;
   struct gl_renderbuffer *rb;
   struct gl_pixelstore_attrib clippedPacking;

   MESA_TRACE_FUNC();

   GET_CURRENT_CONTEXT(ctx);

   FLUSH_VERTICES(ctx, 0, 0);

   if (!no_error && (width < 0 || height < 0)) {
      _mesa_error( ctx, GL_INVALID_VALUE,
                   "glReadPixels(width=%d height=%d)", width, height );
      return;
   }

   _mesa_update_pixel(ctx);

   if (ctx->NewState)
      _mesa_update_state(ctx);

   if (!no_error && ctx->ReadBuffer->_Status != GL_FRAMEBUFFER_COMPLETE_EXT) {
      _mesa_error(ctx, GL_INVALID_FRAMEBUFFER_OPERATION_EXT,
                  "glReadPixels(incomplete framebuffer)" );
      return;
   }
...
}
```

`read_pixels()` 的 prologue 先以 `width < 0 || height < 0` 分支決定是否回報 `GL_INVALID_VALUE`，接著更新 pixel 與 core derived state，再以 `ReadBuffer->_Status` 擋下不完整 FBO。 這裡尚未改寫 `clippedPacking` 或呼叫 driver，表示提前回傳發生在 destination layout 與 resource map 之前

接下來的驗證先依 requested format 選 read renderbuffer，再檢查 API-specific format/type combinations、source buffer existence、整數 signedness class、multisample restrictions 與 multiview restriction。 [Mesa: src/mesa/main/readpix.c:1075](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/readpix.c#L1075-1179) 這些是 API legality，與 destination packing 的位址計算分開

clipping 先複製 `Pack` 到 `clippedPacking`。 `_mesa_clip_readpixels()` 修剪 x、y、width 與 height，同時調整副本中的 `SkipPixels`、`SkipRows` 與 `RowLength`，使原 requested 矩形被 framebuffer bounds 截掉後，destination layout 仍對齊 application 原先要求的位置。 完全被 clip 掉就合法回傳

一般 context 再以原始 `Pack` 驗證 PBO 或 robust buffer range，並拒絕 disallowed mapped PBO。 真正 callback 收到的是 adjusted `clippedPacking`，所以 driver-facing code 不必再次推導 clipping offset

以下程式碼來自 [Mesa: src/mesa/main/readpix.c:1181](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/readpix.c#L1181-1213) 的 `read_pixels()` clipping／destination half。 目的端流程顯示 `_mesa_clip_readpixels()` 同時調整矩形與 local `clippedPacking`，empty 結果直接回傳。 一般 context 再驗證 PBO range／mapping，檢查成功後才將 clipped inputs 交給 `Driver.ReadPixels`：

```c
static ALWAYS_INLINE void
read_pixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format,
            GLenum type, GLsizei bufSize, GLvoid *pixels, bool no_error)
{
...
   /* Do all needed clipping here, so that we can forget about it later */
   clippedPacking = ctx->Pack;
   if (!_mesa_clip_readpixels(ctx, &x, &y, &width, &height, &clippedPacking))
      return; /* nothing to do */

   if (!no_error) {
      if (!_mesa_validate_pbo_access(2, &ctx->Pack, width, height, 1,
                                     format, type, bufSize, pixels)) {
         if (ctx->Pack.BufferObj) {
            _mesa_error(ctx, GL_INVALID_OPERATION,
                        "glReadPixels(out of bounds PBO access)");
         } else {
            _mesa_error(ctx, GL_INVALID_OPERATION,
                        "glReadnPixelsARB(out of bounds access:"
                        " bufSize (%d) is too small)", bufSize);
         }
         return;
      }
...
   }
...
   st_ReadPixels(ctx, x, y, width, height,
                 format, type, &clippedPacking, pixels);
}
```

frontend 到此已完成驗證和 clipping，並將調整後的 destination layout 交給 `st_ReadPixels()`。 State Tracker 接下來會先更新 framebuffer resource，再選擇 staging 路徑並處理 map hazard

#### Flush 提交但不保證等待

Application 呼叫 `glFlush()` 是要讓 pending work 開始向 execution owner 推進，接著仍可繼續工作。 這裡先追 `_mesa_flush()` 如何處理 buffered vertices、選擇 flags，再把 request 交給 `st_glFlush()`，藉此確認 frontend 提供的是 submission progress，而不是 completion wait

`_mesa_Flush()` 先檢查 execution scope，再進 `_mesa_flush()`。 helper flush buffered vertices 後呼叫 `st_glFlush()`。 share group 未包含 externally shared images 時會附上 `PIPE_FLUSH_ASYNC` hint

以下程式碼來自 [Mesa: src/mesa/main/context.c:1604](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1604-1648) 的 `_mesa_flush()` 與 `_mesa_Flush()`，用來確認 `glFlush()` 回傳前只推進 submission、沒有等待 completion。 Internal helper 依 `HasExternallySharedImages` 決定能否加 `PIPE_FLUSH_ASYNC`，先 flush vertices 再呼叫 `st_glFlush()`。 公開入口只取得 current context 並檢查 Begin／End 邊界：

```c
void
_mesa_flush(struct gl_context *ctx)
{
   bool async = !ctx->Shared->HasExternallySharedImages;
   FLUSH_VERTICES(ctx, 0, 0);

   st_glFlush(ctx, async ? PIPE_FLUSH_ASYNC : 0);
}
...
void GLAPIENTRY
_mesa_Flush(void)
{
   GET_CURRENT_CONTEXT(ctx);
   ASSERT_OUTSIDE_BEGIN_END(ctx);
   _mesa_flush(ctx);
}
```

`st_glFlush()` 接收這組 flags 後，會進入 State Tracker 的 submission 路徑。 frontend 在這裡只建立「推進 pending work」的要求。 State Tracker 如何排空自己的 cache、以 `fence = NULL` 呼叫 `pipe->flush()`，會在後面的 State Tracker 章展開

「提交」表示讓 pending work 繼續執行。 函式回傳時，driver 可能仍在工作，API contract 沒有 completion observation。 application 需要明確的 wait 路徑才能取得完成保證

#### Finish 需要等待 completion

Application 呼叫 `glFinish()` 後要等先前 rendering 完成才回傳。 這裡先追 `_mesa_Finish()` 如何處理 buffered vertices，再把阻塞 request 交給 `st_glFinish()`。 State Tracker 取得並等待 completion primitive 的實作留在後文

`_mesa_Finish()` 同樣先取得 context、檢查 execution scope，並 flush buffered vertices。 接著 `st_glFinish()` 進入會要求 driver fence 的 State Tracker 路徑

以下程式碼來自 [Mesa: src/mesa/main/context.c:1618](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1618-1633) 的 `_mesa_Finish()`。 入口執行順序顯示公開函式取得 current context 並拒絕 Begin／End 內呼叫，`FLUSH_VERTICES()` 先推進 buffered work，`st_glFinish()` 隨後進入會要求 driver fence 並等待的 State Tracker 路徑：

```c
void GLAPIENTRY
_mesa_Finish(void)
{
   GET_CURRENT_CONTEXT(ctx);
   ASSERT_OUTSIDE_BEGIN_END(ctx);

   FLUSH_VERTICES(ctx, 0, 0);

   st_glFinish(ctx);
}
```

`st_glFinish()` 接手後會進入要求 fence 並等待 completion 的 State Tracker 路徑。 fence 的取得、等待與 reference 釋放會在後面的 State Tracker 章沿 `st_finish()` 展開

Flush 與 Finish 都先處理 buffered vertices，再交給各自的 State Tracker 入口。 `glFlush()` 回傳時不等待 completion，`glFinish()` 則必須在先前 rendering 完成後才回傳

```callgraph
Mesa OpenGL frontend：operation handoff
=================================================
current gl_context 的 state／pending work
  │
  ├─ Clear
  │    ↓
  │  [Mesa: src/mesa/main/clear.c:137] clear(ctx, mask, no_error)
  │    ├─ 驗證／FBO status 失敗：_mesa_error(...); return;
  │    └─ st_Clear(ctx, bufferMask)
  │       // handoff：實際允許清除的 attachment mask
  │
  ├─ ReadPixels
  │    ↓
  │  [Mesa: src/mesa/main/readpix.c:1044] read_pixels(...)
  │    ├─ 驗證／PBO range 失敗：_mesa_error(...); return;
  │    ├─ if (!_mesa_clip_readpixels(...)) return;
  │    └─ st_ReadPixels(..., &clippedPacking, ...)
  │       // handoff：已完成 clipping 的矩形與 pack state
  │
  ├─ glFlush
  │    ↓
  │  [Mesa: src/mesa/main/context.c:1604] _mesa_flush(ctx)
  │    └─ st_glFlush(ctx, flags)
  │       // handoff：要求推進 pending work，API 不等待 completion
  │
  └─ glFinish
       ↓
     [Mesa: src/mesa/main/context.c:1618] _mesa_Finish()
       └─ st_glFinish(ctx)
          // handoff：要求 State Tracker 等待先前 rendering 完成
```

整條路徑至此都位於 Mesa OpenGL frontend 的責任範圍：保存 API state、執行 legality checks、更新 core derived state，並把整理好的 mask、descriptor、矩形或同步要求交給對應的 State Tracker 入口

State Tracker 如何執行 active dirty atoms、將 operations 送進 Gallium callbacks，以及如何以 fence 區分 submission 與 completion，會在「Mesa State Tracker」章接續

## GLSL compiler 與 NIR 交界

現在讓同一個齒輪情境改由 vertex shader 轉換位置、fragment shader 決定最後顏色。 使用者仍然只看到紅、綠與藍色齒輪持續轉動，但 application 在第一個 draw 以前，必須先將 GLSL source 交給 Mesa，完成 compile、attach 與 link，才能得到 draw 可使用的 executable

以下從 `glShaderSource()` 追到 GLSL frontend、linker、per-stage `gl_program::nir` 與 State Tracker lowering。 Compile、link 與 driver variant 各自解決不同階段的問題，也各自擁有中間資料與失敗清理範圍。 讀清這條路徑後，才能知道齒輪 draw 使用的 executable 從哪裡產生、重新編譯失敗時哪份 NIR 仍有效，以及 softpipe／llvmpipe 或 VirGL 最後取得哪一份 shader state

### Shader source 與 compile

application 已建立一個有固定 stage 的 `gl_shader`，正準備以 `glShaderSource()` 替換文字，再呼叫 `glCompileShader()`。 要判斷舊 source／HIR／NIR 的生命週期、cache fallback 與 compile 失敗如何回到查詢 API，必須從 `set_shader_source()` 追過 parse state、AST／HIR 到 `glsl_to_nir()`。 最後留下的 handoff object 是 `gl_shader::nir`、`CompileStatus` 與 `InfoLog`

```callgraph
Mesa OpenGL shader object
=================================================
glShaderSource(shader, count, strings, lengths)
  ↓
[Mesa: src/mesa/main/shaderapi.c:1193] set_shader_source()
  │
  ├─ if (CompileStatus == COMPILE_SKIPPED && !FallbackSource)
  │    ├─ FallbackSource = Source
  │    └─ Source = source
  │         // 保留 cache fallback 所需的舊文字與雜湊
  └─ 其他 state
       ├─ free((void *)Source)
       └─ Source = source
            // terminal object：同一 gl_shader 擁有新的來源文字
            ↓
glCompileShader(shader)
  ↓
[Mesa: src/mesa/main/shaderapi.c:1237] _mesa_compile_shader()
  │
  ├─ if (!sh->Source)
  │    └─ sh->CompileStatus = COMPILE_FAILURE
  └─ 有 source
       ├─ ensure_builtin_types(ctx)
       └─ _mesa_glsl_compile_shader(ctx, sh, NULL, false, false, false)
            // handoff：gl_context + gl_shader + stage/source
            ↓

Mesa GLSL frontend
=================================================
[Mesa: src/compiler/glsl/glsl_parser_extras.cpp:2386] _mesa_glsl_compile_shader()
  │
  ├─ state->error = glcpp_preprocess(...)
  ├─ if (!state->error)
  │    ├─ _mesa_glsl_parse(state)
  │    └─ do_late_parsing_checks(state)
  ├─ if (!state->error && !translation_unit.is_empty())
  │    └─ _mesa_ast_to_hir(shader->ir, state)
  ├─ shader->CompileStatus = state->error ? COMPILE_FAILURE : COMPILE_SUCCESS
  └─ if (shader->CompileStatus == COMPILE_SUCCESS)
       └─ shader->nir = glsl_to_nir(...)
            ↓
[Mesa: src/compiler/glsl/glsl_to_nir.cpp:174] glsl_to_nir()
  │
  ├─ shader = nir_shader_create(NULL, gl_shader->Stage, options)
  ├─ visitors translate gl_shader->ir
  ├─ ralloc_free(gl_shader->ir); gl_shader->ir = NULL
  └─ return shader
       // 最終結果：gl_shader::nir 保存一份 per-shader NIR
```

source replacement 先更新同一個 `gl_shader` 的 owned text，compile error gates 再決定 AST／HIR／NIR 是否能前進。 成功結果停在 per-shader `gl_shader::nir`。 program attachments 與跨 stage 介面會在後文「Attach、link 與 per-stage program」單元的 link 路徑處理

#### ShaderSource 替換 source 與 cache fallback

當 application 修改 shader code，並再次對同一個 shader object 呼叫 `glShaderSource()` 時，shader name 與 stage 都不會改變。 Mesa 會把新文字放回原本的 `gl_shader`，並判斷上一份 source 是否仍需留給 cache fallback

要知道上一份 source 何時可以釋放、何時必須留下，接下來從 `set_shader_source()` 看 `Source`、`FallbackSource` 與 `source_blake3` 如何更新。 這個函式只處理來源文字的 ownership； 新的 compile 結果要等後續 `glCompileShader()` 才會產生

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:1193](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L1193) 的 `set_shader_source()`，用來確認重新指定來源時舊字串由誰保留。 `COMPILE_SKIPPED && !FallbackSource` 會把 `Source` 轉交給 `FallbackSource`，一般路徑則先 `free()` 舊來源，最後更新 `source_blake3`：

```c
static void
set_shader_source(struct gl_shader *sh, const GLchar *source,
                  const blake3_hash original_blake3)
{
...
   if (sh->CompileStatus == COMPILE_SKIPPED && !sh->FallbackSource) {
      /* If shader was previously compiled back-up the source in case of cache
       * fallback.
       */
      sh->FallbackSource = sh->Source;
      memcpy(sh->fallback_source_blake3, sh->source_blake3, BLAKE3_OUT_LEN);
      sh->Source = source;
   } else {
      /* free old shader source string and install new one */
      free((void *)sh->Source);
      sh->Source = source;
   }

   memcpy(sh->source_blake3, original_blake3, BLAKE3_OUT_LEN);
...
}
```

一般分支先釋放舊 Source，再讓 Source 指向呼叫端已整理完成的新字串。 這表示 gl_shader 擁有 Source，而不是只借用 glShaderSource 呼叫期間的記憶體。 application 在 API 回傳後可以釋放自己的字串，Mesa 後續仍可從 gl_shader 取得完整來源。 因此應追 set_shader_source，而非只看 API 參數複製迴圈。 前者確立 shader object 的長期 state，後者只將 length 陣列與多段文字正規化成一份輸入

COMPILE_SKIPPED 分支保留舊 Source 為 FallbackSource。 這個 state 代表先前的編譯工作可能由 cache 結果替代，因此 Mesa 必須留下可重新編譯的文字。 Source 改指新值時，舊雜湊一併複製到 fallback_source_blake3。 若後續需要回退，來源與其內容識別碼仍保持配對。 一般路徑則沒有這項需要，可以直接 free 舊字串

這段程式碼沒有在此把 CompileStatus 設回成功，也沒有建立 IR。 ShaderSource 的語意是替換來源關聯，compile 結果是否可用由後續 CompileShader 路徑決定。 把兩個動作拆開有兩個重要效果。 第一，application 可以先建立並填入多個 shader，再選擇何時編譯。 第二，查詢 shader source 與查詢 compile log 面對的是同一個 gl_shader，卻是兩組可分別更新的 state

source_blake3 是 Mesa 用來辨識來源內容的內部資料，不承載語言語意。 它讓編譯 cache 與 fallback 判斷不必反覆比較整份文字。 `CompileStatus` 才表示 compile 成功與否，`InfoLog` 保存診斷文字。 source_blake3 只提供來源版本的 identity

從 object 的責任來看，`set_shader_source()` 的輸出是一個尚待編譯的 `gl_shader`，內容包含新來源文字與對應雜湊。 `gl_program` 與 Gallium shader state 會分別在 program link、State Tracker lowering 與 driver create callback 階段建立

#### OpenGL frontend compile 入口

CompileShader 必須啟動一次 Mesa GLSL frontend 編譯，同時遵守 API 對錯誤 state 與查詢結果的要求。 單一 gl_shader 仍是此處的操作對象。 _mesa_compile_shader 負責 frontend 入口前的 state 檢查、建立必要的 builtin 環境、呼叫真正的 GLSL compiler，並依 CompileStatus 決定診斷輸出。 它本身不實作 lexer、parser 或最佳化

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:1237](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L1237)。 這段追蹤 `_mesa_compile_shader()` 如何處理沒有來源的 shader：`!sh->Source` 只會令 `CompileStatus` 成為 `COMPILE_FAILURE`，有來源才建立 builtin types 並呼叫 `_mesa_glsl_compile_shader()`

```c
void
_mesa_compile_shader(struct gl_context *ctx, struct gl_shader *sh)
{
...
   if (!sh->Source) {
      /* If the user called glCompileShader without first calling
       * glShaderSource, we should fail to compile, but not raise a GL_ERROR.
       */
      sh->CompileStatus = COMPILE_FAILURE;
   } else {
      if (ctx->_Shader->Flags & (GLSL_DUMP | GLSL_SOURCE)) {
         _mesa_log("GLSL source for %s shader %d:\n",
                 _mesa_shader_stage_to_string(sh->Stage), sh->Name);
         _mesa_log_direct(sh->Source);
      }

      MESA_TRACE_FUNC();

      ensure_builtin_types(ctx);

      /* this call will set the shader->CompileStatus field to indicate if
       * compilation was successful.
       */
      _mesa_glsl_compile_shader(ctx, sh, NULL, false, false, false);

      if (ctx->_Shader->Flags & GLSL_LOG) {
         _mesa_write_shader_to_file(sh);
      }
   }
...
}
```

沒有 `Source` 時，`!sh->Source` 分支只將 `CompileStatus` 設為 `COMPILE_FAILURE`，不建立 OpenGL error。 frontend 入口在此分隔 API 規則與 compiler 實作，讓 parser 可以假設輸入字串存在，而 API 層仍能呈現規格要求的查詢結果。 application 之後以 `GetShaderiv` 讀取 compile status，以 `GetShaderInfoLog` 讀取診斷，不需要將「沒有先指定 source」視為整個 context 的錯誤 state

ensure_builtin_types 確保內建型態與函式的共用資料已初始化。 這項工作放在真正編譯前，而不是由每個 parser production 臨時建立。 原因是 builtin 是語言環境的一部分，同一 context 內的多次 compile 會重複使用相關定義。 它仍然屬於 compiler orchestration，尚未針對任何硬體能力選擇機器指令

真正改寫 shader 內容的呼叫只有 _mesa_glsl_compile_shader。 註解明確指出該函式負責設定 CompileStatus。 這形成乾淨的回傳 contract。 外層不依賴 parser 的 error counter，也不檢查 HIR 或 NIR 是否為空來推測成敗。 所有 frontend 階段把結果收斂到 gl_shader 欄位，OpenGL 層只讀同一個 state

傳入的三個 false 分別關閉 AST、HIR 的額外輸出與強制重新編譯路徑。 這些參數是 Mesa 內部的觀察與控制功能，不改變 OpenGL API 的 object 模型。 正常 application 路徑只需要來源、context 能力與 shader stage。 若 debug flag 要求列印來源或記錄結果，外層在呼叫前後處理，不把除錯輸出混入 compiler 的主要資料流

這個入口也顯示 compile 與 link 的硬界線。 _mesa_compile_shader 接收 gl_shader，而不是 gl_shader_program。 它不知道其他 stage 是否存在，也不驗證 vertex shader 輸出是否對得上 fragment shader 輸入。 只要單一來源能依指定 stage 編譯，CompileStatus 就可以成功。 跨 shader 與跨 stage 的限制留到 LinkProgram

以錯誤傳遞來看，這裡有兩條路。 沒有來源時，外層直接將 `CompileStatus` 設為失敗。 有來源時，內層 parse state 蒐集錯誤，最後寫回 `CompileStatus` 與 `InfoLog`。 兩條路最後都落在 `gl_shader`，因此查詢 API 不需要知道是哪一層拒絕輸入。 這是 Mesa core 對 compiler 子系統的重要封裝

#### Preprocess、parser、AST、HIR 與最佳化

一份 GLSL 文字必須轉成可驗證、可最佳化的結構化表示，同時保存足以回報給 OpenGL application 的診斷。 操作對象從 source 字串逐步變成 _mesa_glsl_parse_state、AST translation unit 與 gl_shader::ir。 _mesa_glsl_compile_shader 負責安排每個 frontend 階段的先後順序，阻止錯誤輸入進入下一階段，並將 parse state 的結果寫回 gl_shader

以下程式碼來自 [Mesa: src/compiler/glsl/glsl_parser_extras.cpp:2386](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/glsl_parser_extras.cpp#L2386) 的 `_mesa_glsl_compile_shader()`，用來追蹤 frontend 的兩道前置閘門。 `state->error` 會阻止 lexer／parser，`source_has_shader_include && can_skip_compile()` 則會在前置處理後走 cache 早退：

```cpp
void
_mesa_glsl_compile_shader(struct gl_context *ctx,
                          struct gl_shader *shader,
                          FILE *dump_ir_file,
                          bool dump_ast,
                          bool dump_hir,
                          bool force_recompile)
{
...
    struct _mesa_glsl_parse_state *state =
      new(shader) _mesa_glsl_parse_state(ctx, shader->Stage, shader);

   if (ctx->Const.GenerateTemporaryNames)
      (void) p_atomic_cmpxchg(&ir_variable::temporaries_allocate_names,
                              false, true);

   if (!source_has_shader_include || !force_recompile) {
      state->error = glcpp_preprocess(state, &source, &state->info_log,
                                      add_builtin_defines, state, ctx);
   }

   /* Now that we have run the preprocessor we can check the shader cache and
    * skip compilation if possible for those shaders that contained a shader
    * include.
    */
   if (source_has_shader_include &&
       can_skip_compile(ctx, shader, source, source_blake3, force_recompile,
                        true)) {
      log_compile_skip(ctx, shader);
      return;
   }

   if (!state->error) {
     _mesa_glsl_lexer_ctor(state, source);
     _mesa_glsl_parse(state);
     _mesa_glsl_lexer_dtor(state);
     do_late_parsing_checks(state);
   }
...
}
```

parse state 由 shader 作為 ralloc parent 建立，表示它的生命週期附著在這次 shader 編譯工作。 state 同時取得 context、stage 與 shader，因此前置處理和語法分析能查詢語言版本、extension state、stage 限制與內建符號。 這些資料不是 driver callback 的一部分。 它們屬於 OpenGL GLSL frontend 的語意環境

glcpp_preprocess 接收 source 的位址，因此可以讓後續 lexer 使用前置處理後的文字。 它也直接取得 state->info_log 的位址。 若巨集、條件編譯或 include 展開發生問題，state->error 會阻止 parser 執行，診斷則沿同一份 info log 保存。 這比讓 parser 面對半完成的 token stream 更容易維持錯誤定位與恢復行為

state->error 為 false 時，程式會建立 lexer、執行 _mesa_glsl_parse，再銷毀 lexer。 parser 會將 AST 節點串列寫入 parse state 內的 translation_unit，此時尚未產生 NIR。 do_late_parsing_checks 仍在 AST 階段執行，處理必須看到較完整 translation unit 才能判斷的規則。 這些檢查完成以前，程式還沒有進入 Mesa GLSL HIR

cache 早退位於前置處理與 parser 之間，顯示 source identity 並非只取決於 API 收到的原字串。 當文字包含可展開內容時，Mesa 必須先得到有效的前置處理結果，才能判斷既有編譯資料是否可重用。 這是 compiler orchestration 的最佳化，但沒有改變正常資料流。 未命中時仍會進入 lexer 與 parser

以下程式碼來自 [Mesa: src/compiler/glsl/glsl_parser_extras.cpp:2456](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/glsl_parser_extras.cpp#L2456) 的 `_mesa_glsl_compile_shader()`，用來確認舊 IR 清理、AST-to-HIR 閘門與 compile 結果的寫回。 函式先清掉上一輪 `shader->ir`／`shader->nir`，只在 `!state->error && !translation_unit.is_empty()` 時執行 `_mesa_ast_to_hir()`，再把 `CompileStatus` 與 `InfoLog` 收斂回 `gl_shader`：

```cpp
void
_mesa_glsl_compile_shader(struct gl_context *ctx,
                          struct gl_shader *shader,
                          FILE *dump_ir_file,
                          bool dump_ast,
                          bool dump_hir,
                          bool force_recompile)
{
...
   ralloc_free(shader->ir);
   ralloc_free(shader->nir);
   shader->nir = NULL;
   shader->ir = new(shader) ir_exec_list;
   if (!state->error && !state->translation_unit.is_empty())
      _mesa_ast_to_hir(shader->ir, state);

   if (!state->error) {
      validate_ir_tree(shader->ir);

      /* Print out the unoptimized IR. */
      if (dump_hir) {
         _mesa_print_ir(stdout, shader->ir, state);
      }
   }

   if (shader->InfoLog)
      ralloc_free(shader->InfoLog);

   if (!state->error)
      set_shader_inout_layout(shader, state);

   shader->CompileStatus = state->error ? COMPILE_FAILURE : COMPILE_SUCCESS;
   shader->InfoLog = state->info_log;
   shader->Version = state->language_version;
   shader->IsES = state->es_shader;
...
}
```

每次重新編譯先釋放 shader->ir 與 shader->nir，這是 ShaderSource、CompileShader 分離後的結果管理。 新 compile 從目前 source 建立 NIR、HIR 與 AST。 shader->nir 先設成 NULL，shader->ir 則建立新的 ir_exec_list。 即使這次編譯失敗，gl_shader 內留下的 state 也會明確表示本次結果無效

_mesa_ast_to_hir 只有在沒有既有錯誤且 translation unit 非空時執行。 AST 保留較接近語法的結構，HIR 則把名稱解析、型態與 GLSL 語意整理成 compiler 後續 pass 能操作的 IR。 轉換函式直接填入 shader->ir，而 parse state 提供 symbol table、語言版本與錯誤記錄。 若 HIR 建立期間發現語意錯誤，它會更新同一個 state->error

validate_ir_tree 是內部一致性檢查，不等同於 OpenGL link 驗證。 它確認 HIR 結構符合 compiler 自己的資料結構不變量。 set_shader_inout_layout 則把 shader 介面的 layout 資訊整理到 gl_shader，讓後續 linker 有可比較的 stage 輸入與輸出資料。 兩者都只在 state 沒有錯誤時執行

舊 InfoLog 先以 ralloc_free 釋放，新 InfoLog 直接接手 state->info_log。 CompileStatus 也由 state->error 單點決定。 這裡完成了內部 compiler state 到 OpenGL shader object state 的收斂。 Version 與語言模式等解析結果同樣寫回 shader，linker 因而不必重新解析 source 才知道各 shader 使用的語言規則

以下程式碼來自 [Mesa: src/compiler/glsl/glsl_parser_extras.cpp:2487](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/glsl_parser_extras.cpp#L2487) 的 `_mesa_glsl_compile_shader()`，用來顯示 HIR pass 的執行閘門。 只有 `!state->error && !shader->ir->is_empty()` 才會依 `fp16`／`int16` capabilities 執行 `lower_precision()`，再進入 builtin、subroutine lowering 與 `opt_shader()`：

```cpp
void
_mesa_glsl_compile_shader(struct gl_context *ctx,
                          struct gl_shader *shader,
                          FILE *dump_ir_file,
                          bool dump_ast,
                          bool dump_hir,
                          bool force_recompile)
{
...
   if (!state->error && !shader->ir->is_empty()) {
      if (state->es_shader &&
          (ctx->screen->shader_caps[shader->Stage].fp16 ||
           ctx->screen->shader_caps[shader->Stage].int16))
         lower_precision(ctx->screen, shader->Stage, shader->ir);

      lower_builtins(shader->ir);
      assign_subroutine_indexes(state);
      lower_subroutine(shader->ir, state);
      opt_shader(ctx->screen, &ctx->Const, &ctx->Extensions, shader,
                 state->linalloc);
   }
...
}
```

`lower_builtins`、subroutine 處理與 `opt_shader` 都操作 GLSL HIR。 這個順序先把語言層較高階的結構化語意變成後續 IR 可預期的形狀，再做共通最佳化。 `opt_shader` 讀取 screen shader caps 來選擇能力限制與 lowering，資料 object 在這個階段仍是 `gl_shader::ir`

以下程式碼來自 [Mesa: src/compiler/glsl/glsl_parser_extras.cpp:2529](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/glsl_parser_extras.cpp#L2529) 的 `_mesa_glsl_compile_shader()` 收尾，用來確認成功結果與暫時 parse state 的 ownership 交接。 `CompileStatus == COMPILE_SUCCESS` 才複製 `compiled_source_blake3` 並把 `glsl_to_nir()` 結果存入 `shader->nir`，之後刪除 `state->symbols` 並釋放 parse state：

```cpp
void
_mesa_glsl_compile_shader(struct gl_context *ctx,
                          struct gl_shader *shader,
                          FILE *dump_ir_file,
                          bool dump_ast,
                          bool dump_hir,
                          bool force_recompile)
{
...
   if (dump_ir_file) {
      if (shader->CompileStatus) {
         assert(shader->ir);
         _mesa_print_ir(dump_ir_file, shader->ir, NULL);
      }
   }

   if (shader->CompileStatus == COMPILE_SUCCESS) {
      memcpy(shader->compiled_source_blake3, source_blake3, BLAKE3_OUT_LEN);

      shader->nir = glsl_to_nir(shader, ctx->screen->nir_options[shader->Stage],
                                source_blake3);
   }

   delete state->symbols;
   ralloc_free(state);
...
}
```

compiled_source_blake3 在成功路徑才更新，避免失敗輸入冒充可重用的編譯結果。 glsl_to_nir 接收 stage 對應的 nir_options，讓產生的 NIR 一開始就知道 consumer 支援與偏好的 lowering 形式。 然而輸出仍寫入 shader->nir，明確表示它是 per-shader 編譯產物。 parse state 的 symbols 隨後刪除，state 本身也釋放，因為 NIR 不應依賴 parser symbol table 才能存活

把這四個片段合起來，可以得到完整的錯誤閘門。 前置處理錯誤阻止 parser，parser 或晚期檢查錯誤阻止 AST-to-HIR，HIR 錯誤阻止 layout 與最佳化，CompileStatus 失敗則阻止 glsl_to_nir。 每一層只需檢查 `state->error` 或 `CompileStatus`，不必透過 pointer 是否為 NULL 來猜測上一步是否成功

#### HIR 轉成 per-shader NIR

Mesa 舊 GLSL HIR 必須轉成統一的 NIR 資料結構，後續 linker、State Tracker lowering 與 driver compiler 才能使用同一種中介表示。 單一 gl_shader 的 ir_exec_list 是此處的操作對象。 glsl_to_nir 負責建立對應 stage 的 nir_shader，以 visitor 翻譯 HIR，完成轉換後釋放不再需要的 HIR，執行必要的結構 lowering 與驗證，再將 NIR 交還給呼叫端

以下程式碼來自 [Mesa: src/compiler/glsl/glsl_to_nir.cpp:174](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/glsl_to_nir.cpp#L174)。 `glsl_to_nir()` 顯示 HIR 到 NIR 的交接點：`nir_shader_create()` 以 `gl_shader->Stage` 與 `options` 建立新 object，visitor 走訪 `gl_shader->ir` 後立刻釋放 HIR、把 `gl_shader->ir` 清成 `NULL`，再驗證並回傳 NIR

```cpp
nir_shader *
glsl_to_nir(struct gl_shader *gl_shader,
            const nir_shader_compiler_options *options,
            const uint8_t *src_blake3)
{
   MESA_TRACE_FUNC();

   nir_shader *shader = nir_shader_create(NULL, gl_shader->Stage, options);

   nir_visitor v1(shader, src_blake3);
   nir_function_visitor v2(&v1);
   v2.run(gl_shader->ir);
   visit_exec_list(gl_shader->ir, &v1);

   /* The GLSL IR won't be needed anymore. */
   ralloc_free(gl_shader->ir);
   gl_shader->ir = NULL;

   nir_lower_continue_constructs(shader);

   nir_validate_shader(shader, "after glsl to nir, before function inline");
   if (should_print_nir(shader)) {
      printf("glsl_to_nir\n");
      nir_print_shader(shader, stdout);
   }

   return shader;
}
```

nir_shader_create 使用 gl_shader->Stage 與 options 建立目標 object。 stage 會寫入 NIR info，讓所有後續 pass 知道所屬的 OpenGL shader stage，例如 vertex 或 fragment。 options 則是 NIR consumer 的 compiler 選項集合，會影響哪些運算需要 lowering、哪些表示可以保留。 此時還沒有建立 pipe shader state，options 只是讓通用 NIR pipeline 形成 driver 可接受的基礎形狀

轉換分成函式 visitor 與整份 exec list visitor。 前者先處理函式，後者走訪全域指令與宣告。 兩者都將結果填入同一個新 nir_shader。 HIR 節點並非重新掛上不同型態標籤，轉換器會建立另一套 IR object。 因而 HIR 在 visit 完成後可以立即 ralloc_free，gl_shader->ir 也設為 NULL

釋放 HIR 是重要的生命週期界線。 compile 成功後，gl_shader 長期保留的是 shader->nir，而不是同時保有兩份可獨立修改的 IR。 這避免 linker 讀到 HIR、State Tracker 卻修改 NIR 而造成 state 分岔。 若之後重新編譯，_mesa_glsl_compile_shader 仍會先清掉現有 NIR，再從新的 source 建立新的 HIR 與 NIR

nir_lower_continue_constructs 是轉換後立即執行的正規化。 它處理 HIR 與 NIR 控制流程表示之間的差異，讓函式 inline 前的 NIR 符合預期形狀。 nir_validate_shader 的訊息也明確標出驗證時點在 GLSL-to-NIR 之後、函式 inline 之前。 這是 compiler 內部階段標記，不是 OpenGL program link 已完成的意思

函式回傳的 shader 被呼叫端存到 gl_shader::nir。 此處的 per-shader 一詞必須照字面理解。 一個 program 可以 attach 多個 gl_shader，同一 stage 也可能由多個 shader object 組成。 每個 object 在 compile 後各自保存一份 NIR。 linker 稍後才會依 stage 分組、檢查全域符號與介面，並建立 gl_linked_shader

shader->nir 標示 per-shader compile 結果，driver compile 前還有兩次關鍵轉換。 第一次是 linker 從多個 gl_shader::nir 建立每個 stage 的 gl_program::nir。 第二次是 State Tracker 對 linked NIR 做 API state 與 driver capability 相關 lowering，再以 PIPE_SHADER_IR_NIR 包成 Gallium shader state。 只有第二次完成後，driver callback 才取得 ownership

### Attach、link 與 per-stage program

單一 shader compile 成功後，application 將多個 `gl_shader` references attach 到同一個 `gl_shader_program`，再呼叫 `glLinkProgram()` 建立可執行 stages。 此刻必須判斷舊 linked data 何時失效、同 stage 的多個 NIR 如何合併、相鄰 stages 的介面在哪裡驗證，以及新的 `gl_program::nir` 由誰擁有。 這些答案會決定下一節 State Tracker 能否安全建立 driver variants

這個階段有三種生命週期不同的 object。 gl_shader 是 application 以 shader name 操作的 compile 單位。 gl_linked_shader 是一次成功 program link 所產生的 per-stage 容器。 gl_program 則掛在 gl_linked_shader 之下，保存該 stage 的 linked NIR、parameter、pipe shader state 與 variant。 三者的擁有關係會直接解釋重新 link、刪除原始 shader object 與重建 driver variant 時發生的 state 變化

```callgraph
Mesa OpenGL program object
=================================================
glLinkProgram(program)
  ↓
[Mesa: src/mesa/main/shaderapi.c:1377] link_program()
  │
  ├─ shProg == NULL
  │    └─ _mesa_error(ctx, GL_INVALID_VALUE, ...); return
  └─ ctx->Driver.LinkShader(ctx, shProg)
       // handoff：gl_shader_program 與 attached shader references
       ↓
[Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:766] st_link_shader()
  │
  ├─ link_shaders_init(ctx, shProg)
  │    └─ 失敗：LinkStatus 保持失敗並結束
  └─ st_link_glsl_to_nir(ctx, shProg)
       ↓

Mesa GLSL NIR linker
=================================================
[Mesa: src/compiler/glsl/gl_nir_linker.c:3737] gl_nir_link_glsl()
  │
  ├─ 依 stage 建立 shader_list[stage]
  ├─ if (!link_intrastage_shaders(mem_ctx, ctx, prog, shader_list))
  │    └─ return false
  ├─ 驗證相鄰 stage 的 input／output 介面
  └─ return prog->data->LinkStatus
       ↓
[Mesa: src/compiler/glsl/gl_nir_linker.c:2734] link_intrastage_shaders()
  │
  ├─ 合併同 stage 的多個 gl_shader::nir
  ├─ 建立 gl_linked_shader 與 gl_program
  └─ linked->Program->nir = nir_shader_clone(...)
       // ownership handoff：program stage 取得獨立 linked NIR
       ↓

Mesa State Tracker post-link
=================================================
[Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:438] st_link_glsl_to_nir()
  │
  ├─ if (!gl_nir_link_glsl(...))
  │    └─ return GL_FALSE
  ├─ st_glsl_to_nir_post_opts(...)
  └─ st_finalize_program(...)
       // 最終結果：每個 linked gl_program 擁有可供 variant 建立的 NIR
```

link 路徑將 attached shader references 收斂成各 stage 的獨立 `gl_program::nir`，任何 intra-stage 或 inter-stage 失敗都在 post-link finalize 前回傳。 因此 State Tracker 後續只接成功 linked stages，而不接部分可用的 program

#### LinkProgram 進入 State Tracker linker

LinkProgram 一方面必須遵守 OpenGL program object 的可觀察 state，另一方面要將實際 linker 工作交給 State Tracker。 `gl_shader_program` 是此處的操作對象

Mesa core 的 `link_program()` 先檢查 API state，並記錄正在使用此 program 的 stage。 它接著排空會受重新 link 影響的 state，再呼叫 `st_link_shader()`。 State Tracker 的 `st_link_shader()` 負責重建 program link data、檢查 attached shader 的 compile state，並啟動 NIR linker

以下程式碼來自 [Mesa: src/mesa/main/shaderapi.c:1377](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L1377) 的 `link_program()`，用來追蹤重新 link 如何跨過 current context 的 state 邊界。 它先用 `CurrentProgram[stage]->Id == shProg->Name` 建立 `programs_in_use`，執行 `FLUSH_VERTICES()` 後才呼叫 `st_link_shader()`：

```c
static ALWAYS_INLINE void
link_program(struct gl_context *ctx, struct gl_shader_program *shProg,
             bool no_error)
{
...
   capture_shader_program(ctx, shProg);

   unsigned programs_in_use = 0;
   if (ctx->_Shader)
      for (unsigned stage = 0; stage < MESA_SHADER_MESH_STAGES; stage++) {
         if (ctx->_Shader->CurrentProgram[stage] &&
             ctx->_Shader->CurrentProgram[stage]->Id == shProg->Name) {
            programs_in_use |= 1 << stage;
         }
      }

   ensure_builtin_types(ctx);

   FLUSH_VERTICES(ctx, 0, 0);
   st_link_shader(ctx, shProg);
...
}
```

`programs_in_use` 是重新 link 後更新目前 shader state 的依據。 OpenGL 允許對已存在的 program object 再次 link，因此 Mesa 不能只建立新結果而不考慮 context 目前是否正在使用舊 executable。 它在進入 linker 前先記下哪些 stage 指向 `shProg->Name`，成功後才能針對那些 stage 安裝新的 linked 結果

FLUSH_VERTICES 把尚未完成且依賴舊 program state 的工作推過 state 邊界。 重新 link 會替換可用的 executable 與相關 state，因此不能讓先前累積的 draw 在新舊 program 定義之間失去明確順序。 這個 flush 負責 Mesa core 的 state ordering。 `pipe_context::flush` 則在 draw dispatch 之後負責 command submission

st_link_shader 接收完整 gl_shader_program，表示從這裡開始處理的不再是單一 shader compile。 它會看到 NumShaders 與 Shaders 陣列，能依 stage 分組，也能建立 _LinkedShaders。 Mesa core 不直接呼叫 gl_nir_link_glsl，是因為 State Tracker 還要處理 linked program metadata、NIR lowering、program resource list、shader variant 與 driver state 建立

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:766](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_glsl_to_nir.cpp#L766) 的 `st_link_shader()`，用來確認內部 linker 結果如何收斂回 program state。 初始成功時先設 `SamplersValidated`，`st_link_glsl_to_nir()` 回傳 false 就改成 `LINKING_FAILURE`，只有 `LinkStatus` 尚未失敗時才建立 program resource hash：

```cpp
void
st_link_shader(struct gl_context *ctx, struct gl_shader_program *prog)
{
...
   if (prog->data->LinkStatus == LINKING_SUCCESS) {
      prog->SamplersValidated = GL_TRUE;
   }

   if (prog->data->LinkStatus && !st_link_glsl_to_nir(ctx, prog)) {
      prog->data->LinkStatus = LINKING_FAILURE;
   }

   if (prog->data->LinkStatus != LINKING_FAILURE)
      _mesa_create_program_resource_hash(prog);
...
}
```

`LinkStatus` 是整個 program link 的總體 state。 先前任何 attached shader 未成功 compile、同一 program 內的 stage 組合不合法，或後續 NIR link 發生錯誤，都會把它變成 `LINKING_FAILURE`。 `st_link_glsl_to_nir()` 以布林值回報內部成功與否，`st_link_shader()` 再把結果收斂到 program data。 這和 compile 時 `state->error` 最終收斂到 `CompileStatus` 的模式相同

`SamplersValidated` 先設為 true，後續 link 過程若發現衝突會更新它。 program resource hash 只有在 `LinkStatus` 尚未失敗時建立，因為 resource query 應反映這次有效的 linked program。 link 同時接合 shader code，並建立 uniform、attribute、shader storage 與其他 OpenGL program interface 可查詢的 metadata

從呼叫端與 callee 的責任界線看，`link_program()` 處理「這次 OpenGL 呼叫對 current context 有何影響」，`st_link_shader()` 處理「這個 program object 如何產生一組新的 per-stage executable」。 兩者都不應由 driver 實作。 driver 只會在更後面收到已完成 link 與 lowering 的 per-stage shader state

#### Intra-stage 與 inter-stage link

linker 要處理兩層相容性。 同一 stage 可以 attach 多個 shader object，必須先檢查全域符號與介面區塊是否一致，再合併成單一 stage 程式。 不同 stage 之間的輸出與輸入、uniform block 與 location 隨後也必須相容。 操作對象先是依 stage 分組的 gl_shader::nir 陣列，再是 program 的 _LinkedShaders 陣列。 gl_nir_link_glsl 負責安排兩層 link，link_intrastage_shaders 則專注於一個 stage

以下程式碼來自 [Mesa: src/compiler/glsl/gl_nir_linker.c:3737](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/gl_nir_linker.c#L3737)。 `gl_nir_link_glsl()` 先依 `Stage` 將 attached shaders 歸入 `shader_list`／`num_shaders`。 這裡要觀察的是 `IsES` 模式不一致時如何以 `linker_error()` 跳到共同清理路徑，以及暫時 `mem_ctx` 如何隔離 linker 工作資料

```c
bool
gl_nir_link_glsl(struct gl_context *ctx, struct gl_shader_program *prog)
{
...
   void *mem_ctx = ralloc_context(NULL); /* temporary linker context */

   /* Separate the shaders into groups based on their type.
    */
   struct gl_shader **shader_list[MESA_SHADER_MESH_STAGES];
   unsigned num_shaders[MESA_SHADER_MESH_STAGES];

   for (int i = 0; i < MESA_SHADER_MESH_STAGES; i++) {
      shader_list[i] = (struct gl_shader **)
         calloc(prog->NumShaders, sizeof(struct gl_shader *));
      num_shaders[i] = 0;
   }

   unsigned min_version = UINT_MAX;
   unsigned max_version = 0;
   for (unsigned i = 0; i < prog->NumShaders; i++) {
      min_version = MIN2(min_version, prog->Shaders[i]->Version);
      max_version = MAX2(max_version, prog->Shaders[i]->Version);

      if (!consts->AllowGLSLRelaxedES &&
          prog->Shaders[i]->IsES != prog->Shaders[0]->IsES) {
         linker_error(prog, "all shaders must use same shading "
                      "language version\n");
         goto done;
      }

      mesa_shader_stage shader_type = prog->Shaders[i]->Stage;
      shader_list[shader_type][num_shaders[shader_type]] = prog->Shaders[i];
      num_shaders[shader_type]++;
   }
...
}
```

`mem_ctx` 是這次 link 的暫時配置父節點。 分組清單與中間驗證資料只需要活到 `gl_nir_link_glsl()` 回傳，不應成為 program 的長期 state。 真正成功的 linked shader 會另行配置並掛入 `prog->_LinkedShaders`。 暫時工作區與結果 object 分開後，失敗分支可以集中清理前者，不會釋放已交給 program 的結果

`shader_list` 以 Mesa shader stage 為索引，每個元素是一個 `gl_shader` pointer 陣列，`num_shaders` 記錄各 stage 的實際數量。 因此 linker 會接收同 stage 的多個 attached shader，再由 `link_intrastage_shaders()` 產生唯一的 linked 結果

語言版本與模式相容性在分組期間檢查，因為它們屬於整個 program link 的限制。 compile status 描述單一 shader 在各自語言環境下是否合法，program 的 `LinkStatus` 與 `InfoLog` 則由 `linker_error()` 記錄跨 shader 的相容性結果

以下程式碼來自 [Mesa: src/compiler/glsl/gl_nir_linker.c:2734](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/gl_nir_linker.c#L2734) 的 `link_intrastage_shaders()`，用來觀察同 stage 的全域變數與 view count 如何交叉驗證。 `variables` hash table 收集每份 `shader_list[i]->nir` 的定義，非零 `view_mask` 必須一致，衝突時會寫入 linker error 並回傳 `NULL`：

```c
static struct gl_linked_shader *
link_intrastage_shaders(void *mem_ctx,
                        struct gl_context *ctx,
                        struct gl_shader_program *prog,
                        struct gl_shader **shader_list,
                        unsigned num_shaders)
{
...
   /* Check that global variables defined in multiple shaders are consistent.
    */
   struct hash_table *variables =
      _mesa_hash_table_create(mem_ctx, _mesa_hash_string, _mesa_key_string_equal);
   for (unsigned i = 0; i < num_shaders; i++) {
      if (shader_list[i] == NULL)
         continue;
      cross_validate_globals(mem_ctx, &ctx->Const, prog, shader_list[i]->nir,
                             variables, false);
      if (shader_list[i]->ARB_fragment_coord_conventions_enable)
         arb_fragment_coord_conventions_enable = true;
      if (shader_list[i]->KHR_shader_subgroup_basic_enable)
         KHR_shader_subgroup_basic_enable = true;

      if (shader_list[i]->view_mask != 0) {
         if (view_mask != 0 && shader_list[i]->view_mask != view_mask) {
            linker_error(prog, "vertex shader defined with "
                         "conflicting num_views (%d and %d)\n",
                         ffs(view_mask) - 1, ffs(shader_list[i]->view_mask) - 1);
            return NULL;
         }

         view_mask = shader_list[i]->view_mask;
      }
   }
...
}
```

`cross_validate_globals()` 讀取每份 `shader_list[i]->nir`，利用名稱雜湊表比對多個來源對同一全域變數的定義。 這種衝突無法在單一 shader compile 時發現，因為當時 compiler 看不到其他 shader object。 `view_mask` 分支則在數值不同時回傳 `NULL`，因此 intra-stage linker 是第一個能判斷多個編譯單位是否能共同形成一個 stage 的地方

片段中的 stage metadata 也採合併或衝突檢查，而不是隨意選第一份 shader。 若多份來源對同一 stage 執行環境提出不同要求，linker 必須失敗。 這些檢查完成後，函式還會驗證 interface block 與函式簽章，找出 main，建立 linked shader，複製 main 所在 NIR，再把其他編譯單位的函式與全域內容合併進去

以下程式碼來自 [Mesa: src/compiler/glsl/gl_nir_linker.c:3877](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/gl_nir_linker.c#L3877) 的 `gl_nir_link_glsl()` stage loop，用來確認各 stage 的結果何時成為 program state。 `num_shaders[stage] > 0` 才呼叫 `link_intrastage_shaders()`，失敗時刪除暫建 `sh`，成功才寫入 `_LinkedShaders[stage]` 與 `linked_stages`：

```c
bool
gl_nir_link_glsl(struct gl_context *ctx, struct gl_shader_program *prog)
{
...
   /* Link all shaders for a particular stage and validate the result.
    */
   for (int stage = 0; stage < MESA_SHADER_MESH_STAGES; stage++) {
      if (num_shaders[stage] > 0) {
         struct gl_linked_shader *const sh =
            link_intrastage_shaders(mem_ctx, ctx, prog, shader_list[stage],
                                    num_shaders[stage]);

         if (!prog->data->LinkStatus) {
            if (sh)
               _mesa_delete_linked_shader(ctx, sh);
            goto done;
         }

         prog->_LinkedShaders[stage] = sh;
         prog->data->linked_stages |= 1 << stage;
      }
   }
...
}
```

只有存在輸入的 stage 才建立 gl_linked_shader。 成功結果同時寫入 _LinkedShaders 與 linked_stages bitset。 若某 stage 的 intra-stage link 失敗，剛建立的 object 被刪除，整個 program link 直接進入共同清理路徑。 link 不會留下部分 stage 成功、部分 stage 失敗的可用 program

以下程式碼來自 [Mesa: src/compiler/glsl/gl_nir_linker.c:3936](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/gl_nir_linker.c#L3936) 的 `gl_nir_link_glsl()` inter-stage 階段，用來確認哪些檢查會阻止後續 location 分派。 `cross_validate_uniforms()`、subroutine 驗證與 `gl_nir_detect_recursion_linked()` 每次都以 `LinkStatus` 為早退閘門，全部成功後才 inline 函式：

```c
bool
gl_nir_link_glsl(struct gl_context *ctx, struct gl_shader_program *prog)
{
...
   /* Here begins the inter-stage linking phase.  Some initial validation is
    * performed, then locations are assigned for uniforms, attributes, and
    * varyings.
    */
   cross_validate_uniforms(consts, prog);
   if (!prog->data->LinkStatus)
      goto done;

   check_explicit_uniform_locations(consts, exts, prog);

   link_assign_subroutine_types(prog);
   verify_subroutine_associated_funcs(prog);
   if (!prog->data->LinkStatus)
      goto done;

   for (unsigned i = 0; i < MESA_SHADER_MESH_STAGES; i++) {
      if (prog->_LinkedShaders[i] == NULL)
         continue;

      gl_nir_detect_recursion_linked(prog,
                                     prog->_LinkedShaders[i]->Program->nir);
      if (!prog->data->LinkStatus)
         goto done;

      gl_nir_inline_functions(&ctx->screen->caps,
                              prog->_LinkedShaders[i]->Program->nir);
   }
...
}
```

inter-stage 階段面對的已是 `gl_linked_shader::Program::nir`，不再讀原始 source 或 HIR。 每個 `LinkStatus` 早退分支都會停止後續 location 分派。 所有檢查都成功後，linker 才對每個 linked NIR 做 recursion 檢測與 inline，接著逐相鄰 stage 驗證輸出與輸入 interface block，並統一分派 varying、attribute 與 uniform 的位置

intra-stage 與 inter-stage 的分界可以用「同一 stage 內能否形成一個程式」和「各 stage 程式能否組成 pipeline」來記。 前者處理多個 compile unit 的符號與函式，後者處理 stage 之間的介面。 兩者都發生在 driver shader 建立之前，因為 driver 不應重新實作 OpenGL GLSL link 規則

#### NIR clone 到 linked gl_program

application 完成 `glLinkProgram()` 之後，仍可能重新編譯原本的 shader object，或將它標記為刪除。 已經成功 link 的 program 則必須繼續保有目前可用的 executable，直到下一次成功 link 建立新的結果

因此，compile unit 與 linked program 不能共同修改同一份 NIR。 接下來從 `link_intrastage_shaders()` 看 Mesa 如何配置 `gl_linked_shader` 與 `gl_program`，再把 `gl_shader::nir` 複製成 linked program 自己持有的版本

以下程式碼來自 [Mesa: src/mesa/main/shader_types.h:191](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L191) 的 `struct gl_shader`，用來確認單一 shader object 擁有哪些來源與編譯結果。 `Source`／`FallbackSource` 保存來源文字，`InfoLog` 保存診斷，`nir` 與 `ir` 則是重新編譯時必須替換或清理的產物：

```c
...
   const GLchar *Source;  /**< Source code string */
   const GLchar *FallbackSource;  /**< Fallback string used by on-disk cache*/

   GLchar *InfoLog;

   unsigned Version;       /**< GLSL version used for linking */

   /**
    * A bitmask of gl_advanced_blend_mode values
    */
   GLbitfield BlendSupport;

   struct nir_shader *nir;
   struct ir_exec_list *ir;
...
```

`gl_shader` 同時保存 owned source、診斷文字與最近一次 compile 形成的 `nir`／`ir` pointers。 這裡的 `nir` 屬於單一 shader object。 重新指定 source 或重新 compile 時，清理必須先處理這一層的結果

以下程式碼來自 [Mesa: src/mesa/main/shader_types.h:262](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L262) 的 `struct gl_linked_shader`，用來確認 link 後的 stage container 保存哪些欄位。 `Stage` 標記結果所屬階段，`Program` 接住新建的 `gl_program`，`shadow_samplers` 等欄位則明載為 post-link 才設定：

```c
struct gl_linked_shader
{
   mesa_shader_stage Stage;

   struct gl_program *Program;  /**< Post-compile assembly code */

   /**
    * \name Sampler tracking
    *
    * \note Each of these fields is only set post-linking.
    */
   /*@{*/
   GLbitfield shadow_samplers;	/**< Samplers used for shadow sampling. */
   /*@}*/
...
```

`gl_linked_shader` 以 `Stage` 標記 per-stage identity，並透過 `Program` 指向該次 link 新建的 `gl_program`。 `shadow_samplers` 等欄位只在 post-link 階段成立，說明這個 container 已越過單一 shader compile 邊界

以下程式碼來自 [Mesa: src/mesa/main/shader_types.h:487](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shader_types.h#L487)。 `struct gl_program` 顯示 linked stage 如何保存可變與可重建兩種形式：`nir` 持有目前 NIR，`base_serialized_nir` 與 `base_serialized_nir_size` 保存後續 variant 能重新產生基礎 NIR 的資料

```c
struct gl_program
{
   /** FIXME: This must be first until we split shader_info from nir_shader */
   struct shader_info info;

   GLuint Id;
   GLint RefCount;
   GLubyte *String;  /**< Null-terminated program text */

   GLenum16 Format;    /**< String encoding format */

   GLboolean _Used;        /**< Ever used for drawing? Used for debugging */

   struct nir_shader *nir;
   void *base_serialized_nir;
   size_t base_serialized_nir_size;
...
```

`gl_program::nir` 是 linked stage 的可變 NIR owner，`base_serialized_nir` 與 size 則保存後續 variant 可重建的 serialized base。 這兩組欄位讓 link 結果與 driver variant reconstruction 共用同一個 per-stage program 生命週期

以下程式碼來自 [Mesa: src/compiler/glsl/gl_nir_linker.c:2832](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/compiler/glsl/gl_nir_linker.c#L2832) 的 `link_intrastage_shaders()`，用來追蹤 per-stage 結果的配置與 ownership。 `Driver.NewProgram()` 失敗會設定 `LINKING_FAILURE` 並刪除 `linked`，成功後 `linked->Program` 直接接手 `gl_prog`，再以 `nir_shader_clone()` 複製 `main->nir`：

```c
static struct gl_linked_shader *
link_intrastage_shaders(void *mem_ctx,
                        struct gl_context *ctx,
                        struct gl_shader_program *prog,
                        struct gl_shader **shader_list,
                        unsigned num_shaders)
{
...
   struct gl_linked_shader *linked = rzalloc(NULL, struct gl_linked_shader);
   linked->Stage = shader_list[0]->Stage;

   /* Create program and attach it to the linked shader */
   struct gl_program *gl_prog =
      ctx->Driver.NewProgram(ctx, shader_list[0]->Stage, prog->Name, false);
   if (!gl_prog) {
      prog->data->LinkStatus = LINKING_FAILURE;
      _mesa_delete_linked_shader(ctx, linked);
      return NULL;
   }

   _mesa_reference_shader_program_data(&gl_prog->sh.data, prog->data);

   /* Don't use _mesa_reference_program() just take ownership */
   linked->Program = gl_prog;

   linked->Program->nir = nir_shader_clone(NULL, main->nir);

   link_fs_inout_layout_qualifiers(prog, linked, shader_list, num_shaders,
                                   arb_fragment_coord_conventions_enable);
...
}
```

linked 以獨立 ralloc root 配置，Stage 取自同組 shader。 NewProgram 建立 gl_program，失敗時 LinkStatus 立即改為失敗並刪除 linked 容器。 成功時 linked 直接取得 gl_prog ownership，註解特別說明不走一般 reference helper。 這組 object 是一次 program link 的 per-stage 結果

nir_shader_clone 的來源是 main->nir，也就是某個原始 gl_shader 的 per-shader NIR，目的地是 linked->Program->nir。 clone 讓 linker 能在目的 NIR 上 inline 其他編譯單位的函式、合併全域變數、指派 location 與做 lowering，而不改寫原始 gl_shader::nir。 原始 shader object 因而仍可被 attach 到另一個 program，參與不同的 link

這個副本也隔離重新 link。 gl_shader 的 compile 結果可以保持不變，program 重新 link 時刪掉舊 _LinkedShaders 並建立新 gl_program::nir。 若同一 shader object 同時被數個 program attach，每個 program 都會保存獨立的 linked clone 與後續最佳化結果。 不同 program 的介面、其他 attached shader 與 State Tracker variant 不會互相污染

生命週期可以分成三層。 gl_shader::nir 從該 shader 最近一次成功 compile 活到重新 compile 或 shader object 被刪除。 gl_linked_shader 與 gl_program::nir 從 program 最近一次成功 link 活到重新 link 或 program 被刪除。 driver shader variant 則由 gl_program 管理，會因 driver key 或相關 state 改變而建立與釋放。 這三層不應用單一「shader 已編譯」概括

#### State Tracker NIR lowering 與 post opts

通用 GLSL linker 產生的 NIR 仍含 OpenGL program resource、state parameter 與 driver capability 相關的抽象，不能直接假設所有 Gallium driver 接受完全相同的形式。 shader_program->_LinkedShaders 中每個 gl_program::nir 是此處的操作對象。 st_link_glsl_to_nir 負責標記 pipe shader IR 類型、建立 program resource list、依 screen 能力做 lowering、同步 shader_info、準備 stream output 與 parameter，最後建立可供 driver 使用的 program variant

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:438](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_glsl_to_nir.cpp#L438) 的 `st_link_glsl_to_nir()`，用來確認每個 linked stage 如何取得 driver 選項並標記 Gallium IR 類型。 函式先把非 `NULL` 的 `_LinkedShaders[i]` 壓成連續陣列，再讓每個 `shader->Program` 取得 stage-specific `nir_options`，並設定 `prog->state.type = PIPE_SHADER_IR_NIR`：

```cpp
static bool
st_link_glsl_to_nir(struct gl_context *ctx,
                    struct gl_shader_program *shader_program)
{
...
   for (unsigned i = 0; i < MESA_SHADER_MESH_STAGES; i++) {
      if (shader_program->_LinkedShaders[i])
         linked_shader[num_shaders++] = shader_program->_LinkedShaders[i];
   }

   for (unsigned i = 0; i < num_shaders; i++) {
      struct gl_linked_shader *shader = linked_shader[i];
      const nir_shader_compiler_options *options =
         ctx->screen->nir_options[shader->Stage];
      struct gl_program *prog = shader->Program;

      shader->Program->info.separate_shader = shader_program->SeparateShader;
      prog->state.type = PIPE_SHADER_IR_NIR;
...
   }
   ...
}
```

linked_shader 是緊密排列的暫時 pointer 陣列，略過 program 沒有使用的 stage。 後續 loop 因而只處理有效 gl_linked_shader。 每個 stage 從 ctx->screen->nir_options 取得 driver 所宣告的 NIR 選項，但實際 NIR 仍由 shader->Program 持有。 prog->state.type 設為 PIPE_SHADER_IR_NIR，為稍後 pipe shader callback 建立明確的 discriminant

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:521](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_glsl_to_nir.cpp#L521) 的 `st_link_glsl_to_nir()`，用來觀察 program resource list 建好後的 NIR 清理與 capability lowering。 它先移除 `nir_var_shader_in/out`，再依 `indirect_temp_addr`／`indirect_const_addr` 選出 mode，必要時呼叫 `nir_lower_indirect_derefs_to_if_else_trees()`：

```cpp
static bool
st_link_glsl_to_nir(struct gl_context *ctx,
                    struct gl_shader_program *shader_program)
{
...
   for (unsigned i = 0; i < num_shaders; i++) {
      struct gl_linked_shader *shader = linked_shader[i];
      nir_shader *nir = shader->Program->nir;
      mesa_shader_stage stage = shader->Stage;

      /* Since IO is lowered, we won't need the IO variables from now on.
       * nir_build_program_resource_list was the last pass that needed them.
       */
      NIR_PASS(_, nir, nir_remove_dead_variables,
               nir_var_shader_in | nir_var_shader_out, NULL);

      /* If there are forms of indirect addressing that the driver
       * cannot handle, perform the lowering pass.
       */
      if (!ctx->screen->shader_caps[stage].indirect_temp_addr ||
          !ctx->screen->shader_caps[stage].indirect_const_addr) {
         nir_variable_mode mode = (nir_variable_mode)0;

         mode |= !ctx->screen->shader_caps[stage].indirect_temp_addr ?
            nir_var_function_temp : (nir_variable_mode)0;
         mode |= !ctx->screen->shader_caps[stage].indirect_const_addr ?
            nir_var_uniform | nir_var_mem_ubo | nir_var_mem_ssbo :
            (nir_variable_mode)0;

         if (mode)
            nir_lower_indirect_derefs_to_if_else_trees(nir, mode, UINT32_MAX);
      }
...
   }
   ...
}
```

I/O variable 必須等 program resource list 使用完才移除。 OpenGL 的 program interface query 需要 linked 變數資料，若太早刪除，API metadata 會不完整。 resource list 建立後，實際執行用 NIR 已不需要保留已降低的 shader input 與 output 變數，`nir_remove_dead_variables()` 才能安全釋放這些欄位

間接定址 lowering 直接讀取每個 stage 的 shader_caps。 若 driver 不能處理 temporary 或 constant 的間接位址，State Tracker 把對應 dereference 降低成條件控制流程。 這個設計讓 GLSL frontend 保留語言允許的表示，讓 Gallium screen 宣告實作能力，再由兩者交界的 State Tracker 補上差異

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:605](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_glsl_to_nir.cpp#L605) 的 `st_link_glsl_to_nir()` 收尾，用來確認哪些 `shader_info` 欄位不能由 lowering 後的資料覆蓋。 `prog->info` 先取 `prog->nir->info`，再還原 `name`、`label` 與 resource counts，接著準備 per-stage program，儲存 NIR 並釋放 variants，最後執行 `st_finalize_program()`：

```cpp
static bool
st_link_glsl_to_nir(struct gl_context *ctx,
                    struct gl_shader_program *shader_program)
{
...
   for (unsigned i = 0; i < num_shaders; i++) {
      struct gl_linked_shader *shader = linked_shader[i];
      struct gl_program *prog = shader->Program;

      /* Make sure that prog->info is in sync with nir->info, but st/mesa
       * expects some of the values to be from before lowering.
       */
      shader_info old_info = prog->info;
      prog->info = prog->nir->info;
      prog->info.name = old_info.name;
      prog->info.label = old_info.label;
      prog->info.num_ssbos = old_info.num_ssbos;
      prog->info.num_ubos = old_info.num_ubos;
      prog->info.num_abos = old_info.num_abos;

      if (prog->info.stage == MESA_SHADER_VERTEX) {
         prog->info.inputs_read = prog->nir->info.inputs_read;
         prog->DualSlotInputs = prog->nir->info.dual_slot_inputs;

         /* Initialize st_vertex_program members. */
         st_prepare_vertex_program(prog);
      }

      /* Get pipe_stream_output_info. */
      if (shader->Stage == MESA_SHADER_VERTEX ||
          shader->Stage == MESA_SHADER_TESS_EVAL ||
          shader->Stage == MESA_SHADER_GEOMETRY)
         st_translate_stream_output_info(prog);

      st_store_nir_in_disk_cache(st, prog);

      st_release_variants(st, prog);
      char *error = st_finalize_program(st, prog, true);
...
   }
   ...
}
```

prog->info 大部分從降低後的 prog->nir->info 同步，但名稱、標籤與部分在 lowering 前計算的 resource 數量保留舊值。 註解揭示 shader_info 不能不加判斷地整份覆寫。 前一類欄位描述原始 OpenGL program 介面，後一類描述目前 NIR 實際使用情形，State Tracker 必須在邊界上決定各欄位的權威來源

vertex stage 額外準備 DualSlotInputs 與 vertex program 成員，會產生 stream output 的 stage 則翻成 pipe_stream_output_info。 這些都是 Gallium shader state 需要的資料，但來源是 OpenGL linker 已確定的介面資訊。 st_finalize_program 會建立基本 variant，必要時透過 st_create_nir_shader 進入 driver callback

st_release_variants 先釋放舊 variant，表示重新 link 或重新 finalize 不可繼續使用先前 driver shader。 gl_program::nir 是新 linked 結果，variant 必須由它重新建立。 這再次展現 linked NIR 與 driver shader 的生命週期不同。 NIR 是建立 variant 的來源，variant 是特定 driver key 與 lowering 組合下的 executable handle

到這裡，GLSL 語言 link 已完成，OpenGL program resource 已建立，linked NIR 也已依 Gallium screen 能力整理。 下一節追蹤 `pipe_shader_state` 如何表明自己持有 NIR，以及 `create_vs_state`、`create_fs_state` 等 callback 如何取得該 object。 特定硬體的機器指令編譯則從 callback 另一側開始

### Linked NIR 建立 driver variant

program link 已為每個 active stage 留下 `gl_program::nir`，但 draw 前仍需要一個 driver-owned shader handle。 State Tracker 要把 linked NIR 降低成目前 `pipe_screen` 支援的形狀，放進 `pipe_shader_state`，再依 `nir->info.stage` 選擇 `create_*_state` callback。 讀懂 first-variant transfer 與 serialized-NIR 分支，才能判斷 NIR ownership 何時移出 `gl_program`

```callgraph
建立 Mesa State Tracker variant
=================================================
[Mesa: src/mesa/state_tracker/st_program.c:661] get_nir_shader(st, prog, is_draw)
  │
  ├─ if ((!is_draw || !PackedDriverUniformStorage) && prog->nir)
  │    ├─ nir = prog->nir
  │    ├─ prog->nir = NULL
  │    └─ return nir
  │         // 第一個 variant 直接接手 persistent NIR
  └─ 其他 variant
       ├─ blob_reader_init(... prog->serialized_nir ...)
       └─ return nir_deserialize(...)
            // 每個 consumer 取得獨立可變 NIR
            ↓
[Mesa: src/mesa/state_tracker/st_program.c:792] st_create_common_variant()
  │
  │  state.type = PIPE_SHADER_IR_NIR;
  │  state.ir.nir = get_nir_shader(...);
  ├─ if (key->is_draw_shader)
  │    └─ driver_shader = draw_create_vertex_shader(...)
  └─ else
       └─ driver_shader = st_create_nir_shader(st, &state)
            // handoff object：pipe_shader_state + NIR ownership
            ↓

Gallium driver callback 邊界
=================================================
[Mesa: src/mesa/state_tracker/st_program.c:485] st_create_nir_shader()
  │
  │  stage = state->ir.nir->info.stage;
  └─ switch (stage)
       ├─ case MESA_SHADER_VERTEX
       │    └─ pipe->create_vs_state(pipe, state)
       ├─ case MESA_SHADER_FRAGMENT
       │    └─ pipe->create_fs_state(pipe, state)
       └─ 其他 graphics stages
            └─ 對應 create_*_state callback
                 // 最終結果：State Tracker 保存 opaque driver shader handle
```

首個 variant 會從 `gl_program` 移走 persistent NIR，後續 variants 則從 serialized NIR 重建獨立 object。 `pipe_shader_state` 把這份 ownership 交給 stage-specific callback，State Tracker 從此只保存 callback 回傳的 opaque driver handle

#### NIR 交給 Gallium／driver

linked NIR 準備完成後，Mesa 還要讓這個 program 成為 driver 可以 bind 的 executable，application 才能用它發出後續 draw。 Driver 不能直接執行 `gl_program`； State Tracker 必須先把其中的 NIR 交給目前選定的 Gallium driver，再取得一個後續可以 bind 的 driver shader handle

driver 會取得 NIR 的 ownership，並可能繼續修改它，因此這個交接點需要說清楚三件事：payload 如何標示自己是 NIR、shader stage 如何選到對應的 create callback，以及哪一次呼叫會讓 NIR 離開 `gl_program`。 接下來依序看 `pipe_shader_ir`、`pipe_shader_state` 與 `create_*_state` callback

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_defines.h:758](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_defines.h#L758) 的 `enum pipe_shader_ir`，用來確認 Gallium consumer 如何辨識 shader payload。 `PIPE_SHADER_IR_NIR` 與 `PIPE_SHADER_IR_TGSI` 兩個值讓 consumer 直接依 enum 分支解讀 IR，不必檢視 union pointer 內容來猜類型：

```c
/**
 * Shader intermediate representation.
 *
 * Note that if the driver requests something other than TGSI, it must
 * always be prepared to receive TGSI in addition to its preferred IR.
 * If the driver requests TGSI as its preferred IR, it will *always*
 * get TGSI.
 *
 * Note that PIPE_SHADER_IR_TGSI should be zero for backwards compat with
 * gallium frontends that only understand TGSI.
 */
enum pipe_shader_ir
{
   PIPE_SHADER_IR_TGSI = 0,
   PIPE_SHADER_IR_NIR,
};
```

`PIPE_SHADER_IR_NIR` 是 Gallium frontend 與所有 pipe driver 共用的 enum 成員。 State Tracker 在 `st_link_glsl_to_nir()` 已將 `prog->state.type` 設成此值。 driver 收到 state 時依這個欄位選擇 NIR 分支，不需要知道上游原本是 GLSL 文字。 它只依 Gallium contract 解讀 `pipe_shader_state`

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_state.h:294](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_state.h#L294) 的 `struct pipe_shader_state`，用來確認 tagged payload 的欄位配對與 create callback 的 ownership 規則。 `type` 與 `ir.nir` 明確標示 payload，driver 會接手可變 `nir_shader`，frontend 若仍需原 IR 必須先建立獨立副本：

```c
/**
 * The 'type' parameter identifies whether the shader state contains NIR, TGSI
 * tokens, etc.
 *
 * TODO pipe_compute_state should probably get similar treatment to handle
 * multiple IR's in a cleaner way..
 *
 * NOTE: since it is expected that the consumer will want to perform
 * additional passes on the nir_shader, the driver takes ownership of
 * the nir_shader.  If gallium frontends need to hang on to the IR (for
 * example, variant management), it should use nir_shader_clone().
 */
struct pipe_shader_state
{
   enum pipe_shader_ir type;
   /* TODO move tokens into union. */
   const struct tgsi_token *tokens;
   union {
      struct nir_shader *nir;
   } ir;
   struct pipe_stream_output_info stream_output;
...
```

註解明確規定 driver 取得 nir_shader ownership，因為 consumer 通常還會執行額外 NIR pass。 Gallium 的一般規則是 frontend 若要保留同一個可變 IR object，可以先 clone，不能假設 create callback 只讀取傳入 pointer。 這不表示固定版本的 State Tracker 會替每個 variant clone NIR。 它把基礎內容序列化，再由 get_nir_shader 決定此次要移交哪一份 NIR

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_program.c:661](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_program.c#L661) 的 `get_nir_shader()`，用來追蹤每個 variant 取得的 NIR 來源與 ownership。 首份符合 `(!is_draw || !PackedDriverUniformStorage) && prog->nir` 時直接取走 pointer 並把 `prog->nir` 清成 `NULL`，其餘路徑從對應 serialized blob 重新建立 object：

```c
static struct nir_shader *
get_nir_shader(struct st_context *st, struct gl_program *prog, bool is_draw)
{
   if ((!is_draw || !st->ctx->Const.PackedDriverUniformStorage) && prog->nir) {
      nir_shader *nir = prog->nir;

      if (nir->info.stage == MESA_SHADER_VERTEX)
         assert(prog->base_serialized_nir && prog->base_serialized_nir_size);

      /* The first shader variant takes ownership of NIR, so that there is
       * no cloning. Additional shader variants are always generated from
       * serialized NIR to save memory.
       */
      prog->nir = NULL;
      assert(prog->serialized_nir && prog->serialized_nir_size);
      return nir;
   }

   struct blob_reader blob_reader;
   const struct nir_shader_compiler_options *options =
      is_draw ? &draw_nir_options : st->screen->nir_options[prog->info.stage];

   if (is_draw && st->ctx->Const.PackedDriverUniformStorage) {
      assert(prog->base_serialized_nir);
      blob_reader_init(&blob_reader, prog->base_serialized_nir, prog->base_serialized_nir_size);
   } else {
      assert(prog->serialized_nir);
      blob_reader_init(&blob_reader, prog->serialized_nir, prog->serialized_nir_size);
   }
   return nir_deserialize(NULL, options, &blob_reader);
}
```

在 `(!is_draw || !PackedDriverUniformStorage) && prog->nir` 成立時，第一個 variant 直接取得 `prog->nir`，helper 隨即把持久欄位設為 `NULL`，省下一次 clone。 後續 variant 因 `prog->nir` 已為 `NULL`，改從 `serialized_nir` deserialize 出各自可移交的 NIR。 draw shader 配合 `PackedDriverUniformStorage` 時則從 `base_serialized_nir` 重建獨立 object

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_program.c:792](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_program.c#L792)。 `st_create_common_variant()` 顯示移交發生的實際呼叫點：它令 `state.type` 成為 `PIPE_SHADER_IR_NIR`，用 `get_nir_shader()` 填入 `state.ir.nir`，draw shader 交給 `draw_create_vertex_shader()`，其他 stage 則走 `st_create_nir_shader()`

```c
static struct st_common_variant *
st_create_common_variant(struct st_context *st,
                         struct gl_program *prog,
                         const struct st_common_variant_key *key,
                         bool report_compile_error, char **error)
{
   MESA_TRACE_FUNC();

   struct st_common_variant *v = CALLOC_STRUCT(st_common_variant);
   struct pipe_shader_state state = {0};
...
   state.type = PIPE_SHADER_IR_NIR;
   state.report_compile_error = report_compile_error;
   state.ir.nir = get_nir_shader(st, prog, key->is_draw_shader);
   const nir_shader_compiler_options *options = state.ir.nir->options;
...
   if (key->is_draw_shader) {
      NIR_PASS(_, state.ir.nir, gl_nir_lower_images, NULL, false);
      v->base.driver_shader = draw_create_vertex_shader(st->draw, &state);
   }
   else
      v->base.driver_shader = st_create_nir_shader(st, &state);
...
}
```

這個呼叫點證明 variant 建立不是抽象的 clone 假設。 get_nir_shader 先解除 prog->nir 對首份 NIR 的持有，或 deserialize 出新的 NIR。 呼叫端才把該 pointer 交給 create 路徑，並保存回傳的 driver shader handle。 序列化內容負責保留後續 variant 的重建能力，不與已移交 NIR 共用可變 object

`pipe_shader_state` 不只保存 NIR pointer，`stream_output` 也與同一 stage shader 一起送入 driver。 上一節的 `st_translate_stream_output_info()` 會把 OpenGL linker 的 transform feedback 結果轉成這個欄位。 Gallium callback 因而一次取得 shader IR 與建立該 shader state 所需的固定介面資料

type 與 union 的搭配也讓 contract 可被 C callback table 穩定表達。 pipe_context 不需要暴露 C++ NIR 類別方法，driver 也不必連回 OpenGL gl_shader_program。 共用邊界只包含 Gallium 定義的 state struct、nir_shader pointer 與 stage-specific callback。 這是 State Tracker 能同時服務不同 pipe driver 的根本原因

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_program.c:485](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_program.c#L485) 的 `st_create_nir_shader()`，用來確認 tagged union 與 stage dispatch 的兩項入口不變量。 函式先以 `assert(state->type == PIPE_SHADER_IR_NIR)` 驗證 union 的解讀方式，再從 `state->ir.nir->info.stage` 取得 dispatch key，確保 stage-specific callback 收到正確的 NIR payload：

```c
/**
 * Creates a driver shader from a NIR shader.  Takes ownership of the
 * passed nir_shader.
 */
void *
st_create_nir_shader(struct st_context *st, struct pipe_shader_state *state)
{
   struct pipe_context *pipe = st->pipe;

   assert(state->type == PIPE_SHADER_IR_NIR);
   nir_shader *nir = state->ir.nir;
   mesa_shader_stage stage = nir->info.stage;

   /* Renumber SSA defs to make it easier to run diff on printed NIR. */
   nir_foreach_function_impl(impl, nir) {
      nir_index_ssa_defs(impl);
   }
...
}
```

assert 把前面設定的 type 變成入口不變量。 state->ir.nir 必須與 PIPE_SHADER_IR_NIR 配對，nir->info.stage 則必須與即將選擇的 callback 配對。 若任一層把錯誤 union member 或錯誤 stage 傳下來，問題應在 State Tracker 與 Gallium 交界被發現，而不是等到 driver compiler 深處才以不相關錯誤表現

nir_index_ssa_defs 是 handoff 前的最後整理之一。 它重新編號 SSA definition，便於輸出與比較，不改變 OpenGL program link 的語意。 函式註解再次重申它接手傳入 NIR，與 p_state.h contract 的明文行為一致

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_program.c:542](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_program.c#L542) 的 `st_create_nir_shader()` switch，用來確認 stage 如何選到 driver factory。 `MESA_SHADER_VERTEX` 呼叫 `create_vs_state`，tessellation、geometry 與 fragment stages 分別進入各自的 `pipe_context` callback，回傳值統一保存為 shader handle：

```c
void *
st_create_nir_shader(struct st_context *st, struct pipe_shader_state *state)
{
...
   void *shader;
   switch (stage) {
   case MESA_SHADER_VERTEX:
      shader = pipe->create_vs_state(pipe, state);
      break;
   case MESA_SHADER_TESS_CTRL:
      shader = pipe->create_tcs_state(pipe, state);
      break;
   case MESA_SHADER_TESS_EVAL:
      shader = pipe->create_tes_state(pipe, state);
      break;
   case MESA_SHADER_GEOMETRY:
      shader = pipe->create_gs_state(pipe, state);
      break;
   case MESA_SHADER_FRAGMENT:
      shader = pipe->create_fs_state(pipe, state);
      break;
...
   }
   ...
}
```

每個 callback 都接收同一個 pipe_context 與 pipe_shader_state，差別只在 stage-specific 函式槽。 State Tracker 不以 driver 名稱分支，也不認識 driver 內部 shader class。 pipe 指向建立 context 時選定的實作，create_vs_state 等欄位已由該實作註冊。 相同 st_create_nir_shader 因而能把 NIR 交給軟體 rasterizer 或硬體 driver

callback 回傳 void pointer。 State Tracker 把它視為 opaque driver shader handle，掛入 st_variant。 之後 bind 與 delete 也透過 pipe_context callback 操作，無須知道 handle 指向何種實際結構。 這種 opaque handle 設計把 OpenGL program 管理與 driver compiler 的內部資料結構隔開

這個 handoff 同時結束兩條轉換。 語言資料已從 source、AST、HIR 轉成 linked NIR。 API state 也已從 gl_shader_program metadata 轉成 pipe_shader_state 與 stream_output。 driver 最終接到一份依 Gallium contract 正規化的 per-stage state，而非 OpenGL object 拼盤

#### Variant 釋放如何避免再次釋放 NIR

前面已經看到 `get_nir_shader()` 取出一份可移交的 NIR，再由 `create_*_state` callback 把它交給 driver。 當 program 重新 link 或 context 開始 teardown 時，State Tracker 只應刪除 callback 回傳的 driver shader handle，不能再把同一份 NIR 當成 frontend-owned object 釋放

以下註解位於 [Mesa: src/mesa/state_tracker/st_program.c:350](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_program.c#L350) 的 `st_release_variants()` 結尾，用來記錄一般 ownership 規則：任何可能在 create callback 後繼續存在的 `pipe_shader_state`，都應以 `NULL` 表示其中的 NIR 已經移交。 在目前的 common variant 路徑中，`state` 是不再重用的區域變數，持久的 `prog->nir` 則早已由 `get_nir_shader()` 清空

```c
void
st_release_variants(struct st_context *st, struct gl_program *p)
{
...
   /* Note: Any setup of ->ir.nir that has had pipe->create_*_state called on
    * it has resulted in the driver taking ownership of the NIR.  Those
    * callers should be NULLing out the nir field in any pipe_shader_state
    * that might have this called in order to indicate that.
    *
    * GLSL IR and ARB programs will have set gl_program->nir to the same
    * shader as ir->ir.nir, so it will be freed by _mesa_delete_program().
    */
...
}
```

註解把「呼叫 create state」與「driver 取得 NIR」直接連在一起。 可能再次經過釋放路徑的 pipe_shader_state 應把 nir 欄位設為 NULL，用 pointer state 表示 ownership 已移出。 st_create_common_variant 的 state 是不再重用的局部 object。 若這次直接接手 prog->nir，真正需要清空的持久欄位已由 get_nir_shader 在 callback 前設成 NULL

前面看到的 gl_shader::nir clone 解決 shader 與 linked program 之間的獨立性。 此處沒有第二次「variant clone」。 首個符合條件的 variant 移交 prog->nir，後續 variant 從 serialized_nir 重建。 這兩種機制分別處理 program link 與 variant 重建的生命週期，不可混為同一次 clone

driver callback 之後可能進一步降低 NIR、執行 driver-specific 最佳化、建立內部 shader key，最終產生可供其 draw 路徑使用的 executable。 這些工作都位於 pipe_context::create_*_state 的另一側。 它們不再改變 OpenGL CompileStatus、LinkStatus 或 program 介面，也不應回頭依賴 GLSL parser state

GLSL compiler 邊界由三項條件共同界定。 第一，輸入已是完成 program link 的 per-stage NIR。 第二，State Tracker 已依 screen caps 做通用 lowering，並將必要介面資料放入 pipe_shader_state。 第三，stage-specific create callback 已取得 NIR ownership 並回傳 opaque handle。 滿足這三項後，GLSL compiler 與 NIR 交界已完整閉合

這條路徑有兩個穩定接點。 向上是 gl_program::nir，它代表 OpenGL program link 的 per-stage 結果。 向下是 pipe_shader_state 與 create callback，它們代表 Gallium driver 接收 NIR 的 contract。 兩者之間的 State Tracker lowering 是 API 語意轉成 driver capability 形狀的最後一段，GLSL parsing 與 language link 已在上游完成

## Mesa State Tracker

Mesa frontend 已經保存這一幀的 OpenGL state、objects 與 executable program，齒輪 draw 接下來要跨進 driver-neutral 的 Gallium 介面。 State Tracker 位在這個轉換點：它從 `gl_context` 讀取目前使用中的 framebuffer、shader、texture 與 vertex state，只更新 dirty 且本次 draw 會用到的項目，再把它們整理成 `pipe_*` structures 與 callback arguments

這一步要解決的是「OpenGL 已經知道要畫什麼，但不同 Gallium drivers 需要共同輸入」的問題。 2D drisw 基準路徑與 VirGL 3D 路徑此刻都會經過相同的 State Tracker。 以下逐一閱讀 `st_context`、state atoms、sampler view、framebuffer surface、draw、clear、readback、flush 與 finish，確認每次轉換建立哪些 resource references、driver 何時取得它們，以及 fence 如何把完成條件帶回 frontend

### st_context 接住 Mesa core 與 Gallium

在追 application 的 draw 如何穿過 State Tracker 以前，先回到 GLX context 剛建立的時刻。 此時 DRI frontend 正拿著 `pipe_frontend_screen`、context attributes，以及可能用來分享 OpenGL objects 的既有 context，準備建立這條 rendering 路徑後續都會使用的 state

之後每一次 state update、draw、flush 與 drawable 驗證，都會沿這時建立的 object 關係找到 Mesa core 與 Gallium driver。 因此，接下來先沿 `st_api_create_context()` 與 `st_create_context_priv()` 看 `pipe_context`、`gl_context`、CSO cache 與 frontend back pointers 如何依序接起來

```callgraph
Gallium DRI frontend
=================================================
[Mesa: src/gallium/frontends/dri/dri_context.c:46] dri_create_context()
  │
  ├─ if (sharedContextPrivate)
  │    └─ st_share = sharedContextPrivate->st
  ├─ ctx = CALLOC_STRUCT(dri_context)
  │    └─ 失敗：*error = __DRI_CTX_ERROR_NO_MEMORY; goto fail
  └─ ctx->st = st_api_create_context(&screen->base, &attribs, &ctx_err, st_share)
       // handoff：frontend screen、context attributes、optional shared st_context
       ↓

Mesa State Tracker manager
=================================================
[Mesa: src/mesa/state_tracker/st_manager.c:964] st_api_create_context()
  │
  │  pipe = fscreen->screen->context_create(fscreen->screen, NULL, flags);
  ├─ if (!pipe)
  │    └─ *error = ST_CONTEXT_ERROR_NO_MEMORY; return NULL
  └─ st = st_create_context(profile, pipe, mode, shared_ctx, ...)
       ↓
[Mesa: src/mesa/state_tracker/st_context.c:445] st_create_context_priv()
  │
  ├─ st->ctx = ctx
  ├─ st->screen = pipe->screen
  ├─ st->pipe = pipe
  ├─ st->cso_context = cso_create_context(pipe, flags)
  └─ if (!st->cso_context)
       └─ 清理。 return NULL
            // 最終結果：一個 st_context 同時引用 gl_context 與 pipe_context
```

建立順序先固定 adapter-level screen，再配置 per-context pipe，最後才讓 Mesa core、State Tracker 與 CSO cache 依序引用它。 任一步失敗都只清理已完成的前綴，成功結果則由同一個 `st_context` 串起 API state 與 driver callbacks

#### 四個主要 reference

st_context 的主要問題是如何讓同一次 OpenGL context 操作同時抵達 Mesa core 與 Gallium，而不將兩側資料結構合併成一個巨大 object。 操作對象是四個長期 reference。 ctx 指向 Mesa core 的 gl_context，screen 指向 adapter 級 pipe_screen，pipe 指向 per-context 的 pipe_context，cso_context 則包住同一 pipe_context 上的 immutable state cache。 st_context 的責任是保存這些關係並提供雙向轉換所需的共同位置

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_context.h:124](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.h#L124)，用來顯示 `struct st_context` 的四個 pointer 界定跨層關係：`ctx` 提供 OpenGL state，`screen` 提供 capabilities 與 factories，`pipe` 接收 per-context commands，`cso_context` 則 cache 並綁定 immutable state。 `update_functions` 保存 dirty atom 的轉換入口

```c
struct st_context
{
   struct gl_context *ctx;
   struct pipe_screen *screen;
   struct pipe_context *pipe;
   struct cso_context *cso_context;

   /* The list of state update functions. */
   st_update_func_t update_functions[ST_NUM_ATOMS];

   struct pipe_frontend_screen *frontend_screen; /* e.g. dri_screen */
   void *frontend_context; /* e.g. dri_context */
...
```

`ctx` 是 OpenGL state 的權威來源。 shader program binding、texture unit、framebuffer attachment、viewport 與 blend state 等 API 可觀察資料，都先由 Mesa core 以 `gl_context` 及其子 object 保存。 `st_context` 透過 `ctx` reference 讀取這些欄位，再將它們轉成 pipe state

screen 與 pipe 的生命週期層級不同。 `pipe_screen` 代表一個可建立 context 與 resource 的 screen 級介面，能力查詢與 `resource_create` 之類 callback 掛在它上面。 `pipe_context` 則代表一次 rendering context，`draw_vbo`、`set_framebuffer_state`、`set_sampler_views` 與 `flush` 等 callback 掛在它上面

`st_context` 同時需要兩者，因為 state 轉換既會查詢 screen capabilities，也會在 current `pipe_context` 綁定 state 或送出 command

cso_context 是以 `pipe_context` 為 backend 的 state-object cache。 它保存 State Tracker 已送過的 immutable state object 與部分 current binding。 例如 framebuffer state 若與上次相同，cso_set_framebuffer 可以避免重複呼叫 driver。 draw 仍然經由同一個 st->pipe 執行，CSO 層負責 cache 與一致的 dispatch helper

update_functions 陣列緊接在四個 reference 後面，顯示 st_context 也負責 atom 驗證。 陣列索引對應 ST_NEW_* dirty bit，內容是實際更新函式。 State Tracker 不必在每次 draw 無條件翻譯所有 OpenGL state，而是從 gl_context 的 NewDriverState 與 active state mask 求出需要執行的 atom

frontend_screen 與 frontend_context 是回到 DRI object 的 back pointer。 它們不改變四個主要 reference 的分工。 frontend 提供 drawable 驗證與視窗系統整合，screen 與 pipe 提供 Gallium contract，ctx 提供 OpenGL core state，cso_context 則在 State Tracker 內協助去除重複設定

從 ownership 角度看，這些欄位大多是 reference，不表示 st_context 以同一種方式建立與釋放所有 object。 pipe_context 由 pipe_screen::context_create 產生，gl_context 由 st_create_context 建立，cso_context 由 cso_create_context 產生。 teardown 必須依相反順序解除各層 resource，不能只 free st_context 就假設全部完成

#### Context 建立順序

context 建立的關鍵條件是 Gallium pipe_context 必須先存在，Mesa core 與 State Tracker 才能依它的 screen caps、callback table 與共享關係完成初始化。 st_api_create_context 協調這個順序。 它先從 pipe_frontend_screen 取出 pipe_screen，呼叫 context_create，再將結果傳給 st_create_context。 st_create_context_priv 最後建立 st_context 與 cso_context，並將雙向 back pointer 寫入欄位

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_manager.c:1005](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L1005)，用來顯示 `st_api_create_context()` 先透過 `screen->context_create()` 建立 `pipe_context`，並把 threaded、LOD bias 與 API flags 一併傳下。 callback 回傳 `NULL` 時立刻設定 `ST_CONTEXT_ERROR_NO_MEMORY`，成功才進入 `st_create_context()`

```c
struct st_context *
st_api_create_context(struct pipe_frontend_screen *fscreen,
                      const struct st_context_attribs *attribs,
                      enum st_context_error *error,
                      struct st_context *shared_ctx)
{
...
   pipe = fscreen->screen->context_create(fscreen->screen, NULL,
                                          PIPE_CONTEXT_PREFER_THREADED |
                                          lod_bias_flag |
                                          attribs->context_flags);
   if (!pipe) {
      *error = ST_CONTEXT_ERROR_NO_MEMORY;
      return NULL;
   }

   st_visual_to_context_mode(&attribs->visual, &mode);
   if (attribs->visual.color_format == PIPE_FORMAT_NONE)
      mode_ptr = NULL;
   st = st_create_context(attribs->profile, pipe, mode_ptr, shared_ctx,
                          &attribs->options, no_error,
...
}
```

context_create 是 pipe_screen callback，不是直接呼叫某個 driver 名稱。 DRI screen 在較早階段已選定實際 pipe_screen，因此此處只透過共用 contract 建立 pipe_context。 flags 會把 frontend 與 API profile 得出的需求一起傳下去。 若 callback 回傳 NULL，st_api 將錯誤收斂為 ST_CONTEXT_ERROR_NO_MEMORY，尚未建立的 Mesa core context 不需要清理

st_visual_to_context_mode 把 State Tracker visual 轉成 Mesa core 初始化所需的 gl_config。 visual 描述 color、depth、stencil 與 sample 等 framebuffer 能力，並非 drawable 的即時 attachment。 pipe_context 已存在後，st_create_context 才能同時取得 pipe、visual 與可選的 sharing context

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_context.c:803](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.c#L803)。 `st_create_context()` 在 Mesa core context 已配置後呼叫 `st_create_context_priv()`，這裡要觀察失敗回收的邊界：沒有取得 `st` 就依序執行 `_mesa_free_context_data(ctx, true)` 與 `align_free(ctx)`，成功則把新 `st_context` 交還呼叫端

```c
struct st_context *
st_create_context(gl_api api, struct pipe_context *pipe,
                  const struct gl_config *visual,
                  struct st_context *share,
                  const struct st_config_options *options,
                  bool no_error,
                  bool has_egl_image_validate)
{
...
   if (pipe->screen->caps.string_marker)
      ctx->has_string_marker = true;

   st = st_create_context_priv(ctx, pipe, options);
   if (!st) {
      _mesa_free_context_data(ctx, true);
      align_free(ctx);
   }

   return st;
}
```

在這個呼叫之前，st_create_context 已配置並初始化 gl_context，也將 ctx->pipe 與 ctx->screen 指向同一組 Gallium object。 st_create_context_priv 失敗時，函式釋放 Mesa core context data 與對齊配置的 ctx。 成功時回傳 st_context，而 gl_context 可經 ctx->st 找回它

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_context.c:444](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.c#L444)，用來顯示 `st_create_context_priv()` 把既有 object 接成一致的雙向關係：`screen` 固定取自 `pipe->screen`，`ctx->st` 與 `st->ctx` 互指，`st->pipe` 保存同一個 rendering context，`ctx->st_opts` 則指向已複製的 `st->options`

```c
static struct st_context *
st_create_context_priv(struct gl_context *ctx, struct pipe_context *pipe,
                       const struct st_config_options *options)
{
   struct pipe_screen *screen = pipe->screen;
   struct st_context *st = CALLOC_STRUCT( st_context);

   st->options = *options;

   ctx->st_opts = &st->options;
   ctx->st = st;

   st->ctx = ctx;
   st->screen = screen;
   st->pipe = pipe;
...
}
```

screen 直接取自 pipe->screen，未額外向 frontend 查詢，保證 st->screen 與 st->pipe 屬於同一 Gallium screen。 ctx->st 指回新 st_context，st->ctx 又指回 ctx，形成 Mesa core 與 State Tracker 的雙向 reference。 options 被複製進 st，再由 ctx->st_opts 指向同一份設定，避免兩側各自保存可能分歧的副本

cso_context 稍後以 cso_create_context(pipe, cso_flags) 建立。 cso_flags 依 API profile 與 vertex buffer 行為決定，但底層仍是同一 pipe。 建立完成後，st->cso_context 與 ctx->cso_context 都指向它，讓 Mesa core callback 與 State Tracker helper 可以共用相同 cache state

這個順序可用依賴關係理解。 pipe_screen 已由 screen 建立階段存在，pipe_context 是第一個 per-context object。 gl_context 依 pipe 與 visual 初始化，st_context 再把兩側接起來，最後 CSO cache 依 pipe 建立。 任何中途失敗都只需清理由此之前已成功配置的層級

#### DRI frontend 進入點

DRI frontend 必須將 GLX context 建立 request 轉成 State Tracker 能理解的 attribs、visual 與 share reference。 操作對象是 dri_context 與 st_context_attribs。 driCreateContextAttribs 等外層路徑完成 profile 與 option 驗證後，這裡呼叫 st_api_create_context。 成功回傳的 st_context 存入 dri_context，frontend_context back pointer 隨後指回 DRI object

以下程式碼來自 [Mesa: src/gallium/frontends/dri/dri_context.c:165](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L165)，用來顯示 DRI context 路徑在這裡把 loader 資料轉成 State Tracker 輸入：只有 `MESA_NO_ERROR` 啟用且使用者身分允許時才加上 `ST_CONTEXT_FLAG_NO_ERROR`，接著由 `dri_fill_st_visual()` 填 visual，並把 `st_api_create_context()` 結果存入 `ctx->st`

```c
struct dri_context *
dri_create_context(struct dri_screen *screen,
                   gl_api api, const struct gl_config *visual,
                   const struct __DriverContextConfig *ctx_config,
                   unsigned *error,
                   struct dri_context *sharedContextPrivate,
                   void *loaderPrivate,
                   bool thread_safe)
{
...
   ctx->screen = screen;
   ctx->loaderPrivate = loaderPrivate;

   /* KHR_no_error is likely to crash, overflow memory, etc if an application
    * has errors so don't enable it for setuid processes.
    */
   if (debug_get_bool_option("MESA_NO_ERROR", false) ||
       driQueryOptionb(&screen->dev->option_cache, "mesa_no_error"))
#if !defined(_WIN32)
      if (__normal_user())
#endif
         attribs.flags |= ST_CONTEXT_FLAG_NO_ERROR;

   attribs.options = screen->options;
   dri_fill_st_visual(&attribs.visual, screen, visual);
   ctx->st = st_api_create_context(&screen->base, &attribs, &ctx_err,
...
}
```

dri_fill_st_visual 先把 DRI visual 轉成 State Tracker visual，然後 st_api_create_context 接收 screen->base。 base 是 pipe_frontend_screen，內含已選定的 pipe_screen 與 frontend callback。 sharing context 以 st_share 傳入，讓 Mesa core 在 st_create_context 中取得對應 share->ctx

錯誤不直接以 pipe 或 Mesa 內部 enum 暴露給 DRI 呼叫端。 st_api 使用 st_context_error，DRI 再於 [Mesa: src/gallium/frontends/dri/dri_context.c:182](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L182) 映射到 DRI context error enum。 每一層只翻譯自己邊界上的錯誤 contract

成功時 ctx->st 保存 State Tracker context，[Mesa: src/gallium/frontends/dri/dri_context.c:196](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L196) 再讓 st->frontend_context 保存 dri_context，後續 drawable 驗證與 flush callback 才能回到正確 frontend instance

這個入口也建立視窗系統 handoff。 DRI 負責把 Xorg 與 GLX 路徑建立的 drawable、visual 與 share request 轉給 State Tracker，State Tracker 從此只操作 frontend 介面與 Gallium 介面。 後面的 atom、resource 與 draw 路徑不會反覆解析 GLX request

### State atom 驗證

application 已連續修改多項 OpenGL state，`gl_context::NewDriverState` 因而累積 dirty bits，driver callbacks 尚未收到更新。 draw 前必須同時考慮本次 operation 的 pipeline mask、實際變更與 active shader stages，否則會漏掉相依 state 或存取不存在的 stage binding。 `st_prepare_draw()` 與 `st_validate_state()` 會將三個集合收斂成依序執行的 atoms

```callgraph
Mesa State Tracker callback registration prerequisite
=================================================
[Mesa: src/mesa/state_tracker/st_context.c:445-485] st_create_context_priv()
  │
  └─ update_functions[ST_NEW_*] = st_update_* callback
       // context 建立時保存 atom index 到 update 函式的固定對應
       ↓ 後續 draw 使用已註冊的 table

Mesa OpenGL draw preparation
=================================================
[Mesa: src/mesa/main/draw.c:1142] _mesa_draw_arrays()
  │
  ├─ if (!count || !numInstances)
  │    └─ return
  └─ ST_PIPELINE_RENDER_STATE_MASK(mask);
     st_prepare_draw(ctx, mask);
       // handoff：current gl_context + 本次 pipeline 所需 atom mask
       ↓
[Mesa: src/mesa/state_tracker/st_draw.c:75] st_prepare_draw()
  │
  │  assert(ctx->NewState == 0x0);
  ├─ if (!st->bitmap.cache.empty)
  │    └─ st_flush_bitmap_cache(st)
  ├─ st_invalidate_readpix_cache(st)
  └─ st_validate_state(st, state_mask)
       ↓

Mesa State Tracker atom 驗證
=================================================
[Mesa: src/mesa/state_tracker/st_util.h:119] st_validate_state()
  │
  │  dirty = state_mask & ctx->NewDriverState & st->active_states;
  ├─ if (!dirty)
  │    └─ return                         // 本次 draw 無 atom callback
  └─ dirty != 0
       ├─ BITSET_ANDNOT(ctx->NewDriverState, ..., dirty)
       └─ BITSET_FOREACH_SET(i, dirty, ST_NUM_ATOMS)
            └─ st->update_functions[i](st)
                 // 執行期 dispatch 到建立 context 時註冊的 callback
                 ↓ representative ST_NEW_FRAMEBUFFER callback
[Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:111] st_update_framebuffer_state()
  │
  ├─ st_manager_validate_framebuffers(st)
  ├─ framebuffer.cbufs／zsbuf = current renderbuffer surfaces
  └─ cso_set_framebuffer(st->cso_context, &framebuffer)
       // 最終結果：必要 framebuffer atom 已更新到 pipe_context 路徑
```

draw 驗證的有效輸入是 operation mask、累積 dirty bits 與 active stages 的交集。 atom table 提供固定 dependency order，所有必要 callbacks 完成後才把 control 交給 draw dispatch

#### 從 Mesa core dirty state 產生 State Tracker atoms

`st_validate_state()` 能挑選 atoms 以前，Mesa core 的 `_NEW_*` dependencies 必須先轉成 `NewDriverState` 使用的 `ST_NEW_*` bits。 `_mesa_update_state_locked()` 在清除 `NewState` 前呼叫 `st_invalidate_state()`，讓 State Tracker 依這一輪 core 變更標記所有可能受到影響的 Gallium-facing state

以下片段依序來自 [Mesa: src/mesa/state_tracker/st_context.c:75](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.c#L75-84) 的 `st_invalidate_buffers()` 與 [Mesa: src/mesa/state_tracker/st_context.c:100](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.c#L100-129) 的 `st_invalidate_state()`。 `_NEW_BUFFERS` 會展開成 framebuffer、blend、depth/stencil、sample、viewport、scissor 與其他依賴 attachment state 的 atoms：

```c
void
st_invalidate_buffers(struct st_context *st)
{
   ST_SET_STATE4(st->ctx->NewDriverState, ST_NEW_BLEND, ST_NEW_DSA,
                 ST_NEW_FB_STATE, ST_NEW_SAMPLE_STATE);
   ST_SET_STATE4(st->ctx->NewDriverState, ST_NEW_SAMPLE_SHADING,
                 ST_NEW_FS_STATE, ST_NEW_POLY_STIPPLE, ST_NEW_VIEWPORT);
   ST_SET_STATE3(st->ctx->NewDriverState, ST_NEW_RASTERIZER,
                 ST_NEW_SCISSOR, ST_NEW_WINDOW_RECTANGLES);
}

void
st_invalidate_state(struct gl_context *ctx)
{
   GLbitfield new_state = ctx->NewState;
   struct st_context *st = st_context(ctx);
   ...
   if (new_state & _NEW_BUFFERS) {
      st_invalidate_buffers(st);
   } else {
      ...
   }
}
```

這一步只把可能過期的 State Tracker state 加入 `NewDriverState`，不立即執行 update 函式。 多個 setters 與 core-derived dependencies 可以在下一個 consumption point 前持續 OR 進同一份 bitset。 draw、clear 或 readback 再用自己的 operation mask 選出本輪真正需要的 atoms

#### Atom table 與 dependency order

atom table 要同時回答兩個問題。 一個 dirty bit 應呼叫哪個更新函式，以及多個 dirty bit 同時出現時應採什麼順序。 操作對象是 st_context::update_functions 與以 ST_STATE 列出的編譯期清單。 st_create_context_priv 用巨集展開建立函式表，st_atom_list.h 的排列直接定義 dependency order

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_context.c:480](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_context.c#L480)，用來顯示 `st_create_context_priv()` 先以 `cso_create_context(pipe, cso_flags)` 建立共用 CSO，再把 `ST_STATE(FLAG, st_update)` 展開成 `update_functions[FLAG] = st_update`。 這證明 atom 清單同時決定函式表索引與實際 callback

```c
static struct st_context *
st_create_context_priv(struct gl_context *ctx, struct pipe_context *pipe,
                       const struct st_config_options *options)
{
...
   st->is_threaded_context = pipe->draw_vbo == tc_draw_vbo;

   st->cso_context = cso_create_context(pipe, cso_flags);
   ctx->cso_context = st->cso_context;

#define ST_STATE(FLAG, st_update) st->update_functions[FLAG] = st_update;
#include "st_atom_list.h"
#undef ST_STATE

   st_init_clear(st);
...
   st_init_pbo_helpers(st);
...
}
```

`ST_STATE` 在 include 前暫時定義為陣列賦值，因此 `st_atom_list.h` 中每一列 `ST_STATE(flag, function)` 都會展開成 `update_functions[flag] = function`。 include 完成後立即 undef，這份清單便能在其他需要相同順序或 metadata 的位置用不同巨集語意重複展開

表的 index 由 ST_NEW_* flag 決定，執行順序卻由 BITSET_FOREACH_SET 走訪 index 的順序決定。 atom enum 與 st_atom_list 的排列因而形成一項共同不變量。 若新增 atom 只選一個空 bit，卻忽略依賴 atom 的前後關係，就可能讓 consumer 讀到上一輪的 pipe state

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_list.h:13](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_list.h#L13)，用來顯示這組 `ST_STATE` entries 用排列本身表達 sampler 相依性：各 stage 的 `ST_NEW_*_SAMPLER_VIEWS`／`st_update_*_textures` 都在 `ST_NEW_*_SAMPLERS`／`st_update_*_samplers` 前面，確保後者計算 swizzle 時能讀到最新 view

```c
...
ST_STATE(ST_NEW_POLY_STIPPLE, st_update_polygon_stipple)
ST_STATE(ST_NEW_WINDOW_RECTANGLES, st_update_window_rectangles)
ST_STATE(ST_NEW_BLEND_COLOR, st_update_blend_color)

ST_STATE(ST_NEW_VS_SAMPLER_VIEWS, st_update_vertex_textures)
ST_STATE(ST_NEW_FS_SAMPLER_VIEWS, st_update_fragment_textures)
ST_STATE(ST_NEW_GS_SAMPLER_VIEWS, st_update_geometry_textures)
ST_STATE(ST_NEW_TCS_SAMPLER_VIEWS, st_update_tessctrl_textures)
ST_STATE(ST_NEW_TES_SAMPLER_VIEWS, st_update_tesseval_textures)
ST_STATE(ST_NEW_TS_SAMPLER_VIEWS, st_update_task_textures)
ST_STATE(ST_NEW_MS_SAMPLER_VIEWS, st_update_mesh_textures)

/* Non-compute samplers. */
ST_STATE(ST_NEW_VS_SAMPLERS, st_update_vertex_samplers) /* depends on update_*_texture for swizzle */
ST_STATE(ST_NEW_TCS_SAMPLERS, st_update_tessctrl_samplers) /* depends on update_*_texture for swizzle */
ST_STATE(ST_NEW_TES_SAMPLERS, st_update_tesseval_samplers) /* depends on update_*_texture for swizzle */
ST_STATE(ST_NEW_GS_SAMPLERS, st_update_geometry_samplers) /* depends on update_*_texture for swizzle */
ST_STATE(ST_NEW_FS_SAMPLERS, st_update_fragment_samplers) /* depends on update_*_texture for swizzle */
...
```

各 shader stage 的 `ST_NEW_*_SAMPLER_VIEWS` atom 排在 sampler atom 之前。 註解指出 sampler swizzle 依賴 texture update。 原因是 OpenGL texture format、view format 與 texture swizzle 共同影響 driver sampler state。 view 更新後，sampler atom 會取得最新的 view 與 format 資訊，再據此計算 swizzle

這份順序用於同一輪出現多個 dirty bit 的情況。 它只決定 atom 的先後，不要求每次執行所有列。 若只有 fragment sampler view dirty，其他 stage 的函式不會被呼叫。 若 view 與 sampler 同時 dirty，bit order 才確保 view update 先完成

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_list.h:42](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_list.h#L42)，用來顯示另一段 `st_atom_list.h` 排序驗證 framebuffer 的前置地位：`ST_NEW_FB_STATE`／`st_update_framebuffer_state` 先執行，blend、rasterizer、sample、scissor 與 viewport atoms 才能依新的 attachment 尺寸與 sample state 更新

```c
...
ST_STATE(ST_NEW_FB_STATE, st_update_framebuffer_state) /* depends on update_*_texture and bind_*_images */
ST_STATE(ST_NEW_BLEND, st_update_blend) /* depends on update_framebuffer_state */
ST_STATE(ST_NEW_RASTERIZER, st_update_rasterizer) /* depends on update_framebuffer_state */
ST_STATE(ST_NEW_SAMPLE_STATE, st_update_sample_state) /* depends on update_framebuffer_state */
ST_STATE(ST_NEW_SAMPLE_SHADING, st_update_sample_shading)
ST_STATE(ST_NEW_SCISSOR, st_update_scissor) /* depends on update_framebuffer_state */
ST_STATE(ST_NEW_VIEWPORT, st_update_viewport) /* depends on update_framebuffer_state */

ST_STATE(ST_NEW_VS_CONSTANTS, st_update_vs_constants)
...
```

`ST_NEW_FB_STATE` 分支先讀取 attachment 對應的 `pipe_surface`，確定 width、height、sample count 與實際 render target。 blend、rasterizer、sample、scissor 與 viewport 都可能依 framebuffer 結果調整，因此 framebuffer atom 排在它們之前。 若先送 blend 或 viewport，再更新 framebuffer，driver 可能短暫收到由舊 attachment 尺寸或 sample state 推得的設定

相依註解讓 atom table 同時成為可執行規格。 閱讀某個 state 為何在 draw 前更新時，需同時搜尋誰設定 dirty bit，以及它在 st_atom_list 的位置。 dirty bit 解釋「是否需要更新」，清單順序解釋「何時更新」，update 函式則解釋「如何轉成 pipe state」

#### 只執行 dirty 且 active 的 atom

State Tracker 不應更新未變更的 state，也不應為目前 pipeline 沒有使用的 shader stage 建立無效 binding。 st_validate_state 將呼叫端提供的 pipeline_state_mask 複製到局部 dirty bitset，再依序和 ctx->NewDriverState、st->active_states 取交集。 結果非空時，它先從 NewDriverState 清掉本輪負責的 bits，再逐 bit 呼叫 update 函式

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_util.h:118](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_util.h#L118)，用來顯示 `st_validate_state()` 將 `pipeline_state_mask`、`ctx->NewDriverState` 與 `st->active_states` 取交集。 只有結果非空才先用 `BITSET_ANDNOT` 清掉本輪 bits，再依序呼叫 `st->update_functions[i](st)`

```c
static inline void
st_validate_state(struct st_context *st, const st_state_bitset pipeline_state_mask)
{
   struct gl_context *ctx = st->ctx;

   /* Inactive states are shader states not used by shaders at the moment. */
   st_state_bitset dirty;
   BITSET_COPY(dirty, pipeline_state_mask);
   BITSET_AND(dirty, dirty, ctx->NewDriverState);
   BITSET_AND(dirty, dirty, st->active_states);

   if (!BITSET_IS_EMPTY(dirty)) {
      BITSET_ANDNOT(ctx->NewDriverState, ctx->NewDriverState, dirty);

      /* Execute functions that set states that have been changed since
       * the last draw.
       */
      unsigned i;
      BITSET_FOREACH_SET(i, dirty, ST_NUM_ATOMS)
         st->update_functions[i](st);
   }
}
```

`pipeline_state_mask` 欄位由目前 operation 決定。 render draw、clear 或其他路徑需要的 state 集合可能不同。 呼叫端先排除這次根本不會讀取的 atom，避免一個與 draw 無關的 dirty bit 引發額外轉換

NewDriverState 保存自上次 driver 驗證之後有變化的 State Tracker state。 Mesa core API 路徑更新 state 時會加入相應 ST_NEW bit。 若相同 OpenGL state 在兩次 draw 間改動多次，bit 仍只表示需要重新翻譯一次，不會為每次 setter 重播 driver callback

active_states 再排除目前 shader pipeline 沒有使用的 state。 例如沒有某個 stage 時，該 stage 的 sampler view、sampler、constant buffer 與 image atom 沒有必要執行。 這個過濾也避免 update 函式假設對應 program 或 binding 存在

三個集合的交集才是真正的 dirty。 pipeline mask 回答這次 operation 需要什麼，NewDriverState 回答哪些內容已變，active_states 回答目前 pipeline 能使用什麼。 少任何一層都可能產生不必要 callback，或讓不適用的 atom 存取空 stage state

BITSET_ANDNOT 在執行 update 函式前清掉本輪 dirty bits。 update 函式若因轉換結果又標記其他 state，新的 bit 會保留到下一次驗證，不會在函式回傳後被整批誤清

本輪 BITSET_FOREACH_SET 只走訪呼叫 update 函式前算好的局部 dirty snapshot，因此不會處理後來新增的 bit。 既有 snapshot 仍依 bit 順序套用前一節的 dependency order

#### Draw 前的 state mask

draw 入口的責任是先讓 Mesa core 驗證完成，再以 render pipeline mask 要求 State Tracker 更新必要 atom。 _mesa_draw_arrays 建立 pipe_draw_info 與 draw range 後，透過 ST_PIPELINE_RENDER_STATE_MASK 取得 mask，呼叫 st_prepare_draw，最後才進入 DrawGallium。 st_prepare_draw 則處理暫存 cache、確認 core state 已乾淨，並呼叫 st_validate_state

以下程式碼來自 [Mesa: src/mesa/main/draw.c:1167](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L1167)。 core draw 路徑先填 `pipe_draw_info` 與 `draw.start/count`，再以 `ST_PIPELINE_RENDER_STATE_MASK(mask)` 呼叫 `st_prepare_draw()`。 這個順序證明 `ctx->Driver.DrawGallium()` 執行前，render pipeline 所需 atoms 已完成驗證與 binding

```c
static void
_mesa_draw_arrays(struct gl_context *ctx, GLenum mode, GLint start,
                  GLsizei count, GLuint numInstances, GLuint baseInstance)
{
...
   info.start_instance = baseInstance;
   info.instance_count = numInstances;
   info.min_index = start;
   info.max_index = start + count - 1;

   draw.start = start;
   draw.count = count;

   ST_PIPELINE_RENDER_STATE_MASK(mask);
   st_prepare_draw(ctx, mask);

   ctx->Driver.DrawGallium(ctx, &info, ctx->DrawID, NULL, &draw, 1);
...
}
```

pipe_draw_info 在 core draw 路徑就開始填入，但 driver callback 尚未執行。 st_prepare_draw 位於 DrawGallium 前面，確保 shader、sampler view、framebuffer、viewport 與其他 draw state 已先透過 pipe_context callback 綁定。 draw dispatch 因而可以假設 current pipe_context state 與這份 draw_info 相容

ST_PIPELINE_RENDER_STATE_MASK 代表一般 render pipeline 所需 atom。 同一份 st_validate_state 也能由不同 operation 傳入其他 mask，這就是函式不在內部硬編碼完整 ST_NEW 集合的原因。 mask 將「這次要做哪種工作」留給呼叫端，dirty 與 active 過濾則由共用 helper 完成

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_draw.c:74](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_draw.c#L74)，用來顯示 `st_prepare_draw()` 以 `assert(ctx->NewState == 0x0)` 要求 Mesa core state 已收斂，必要時清掉 bitmap cache、使 readpix cache 失效，最後才把呼叫端的 `state_mask` 交給 `st_validate_state()` 並以 `st_context_add_work()` 記錄工作

```c
void
st_prepare_draw(struct gl_context *ctx, const st_state_bitset state_mask)
{
   struct st_context *st = ctx->st;

   /* Mesa core state should have been validated already */
   assert(ctx->NewState == 0x0);

   if (unlikely(!st->bitmap.cache.empty))
      st_flush_bitmap_cache(st);

   st_invalidate_readpix_cache(st);

   /* Validate state. */
   st_validate_state(st, state_mask);
   st_context_add_work(st);
}
```

`assert(ctx->NewState == 0x0)` 區分 Mesa core 驗證與 State Tracker 驗證。 `NewState` 是 core 尚未衍生完成的 OpenGL state，`NewDriverState` 則是已可轉成 driver state 的 dirty 集合。 若 core state 尚未收斂，State Tracker 不應直接讀取它建立 pipe state

bitmap cache 必須先 flush，因為延遲的 bitmap 工作可能依賴先前 state。 readpix cache 則在 draw 前失效，避免之後的讀回誤用 draw 之前的內容。 這兩項 cache 處理完成後才呼叫 st_validate_state，最後 st_context_add_work 增加 context 工作計數

draw 前驗證的輸出是已更新的 `pipe_context` state bindings，真正的 draw 由下一個 callback 發生。 這項分離讓同一套 atom 系統可以服務單筆 draw、multi draw 與其他會使用 render pipeline state 的路徑

### GL resource 到 Gallium resource／view

texture state 已成為 draw 所需的 active atom，State Tracker 手上有 `gl_texture_object`、image layout、texture-unit binding 與 current `pipe_context`。 要判斷 storage、CPU map 與 shader view 的 reference 是否同一 object，以及 unmap／unbind 應釋放哪一層，必須分別追 `pipe_resource`、`pipe_transfer` 與 `pipe_sampler_view` 的 create／bind callbacks

同樣地，renderbuffer 也直接使用 gl_renderbuffer 中的 pipe_resource、pipe_surface 與 pipe_transfer 欄位，不存在獨立 st_renderbuffer 結構。 名稱中仍可能出現歷史函式名稱，但判斷資料模型必須看實際 struct 定義與欄位存取，不能從 helper 名稱推測繼承層次

```text
gl_texture_object
  ├─ pt：引用 pipe_resource storage
  └─ sampler_views：保存 per-context shader-visible views

storage 建立
  └─ st_texture_create()
       └─ pipe_screen::resource_create()

CPU mapping
  └─ st_texture_image_map()
       └─ pipe_context::texture_map()
            └─ pipe_transfer 保存 resource、box、stride 與 usage

shader binding
  └─ st_create_texture_sampler_view_from_stobj()
       └─ pipe_context::create_sampler_view()
            └─ pipe_context::set_sampler_views()
```

#### Texture object 直接持有 pipe_resource

這個版本的 storage identity 直接保存在 gl_texture_object::pt。 本節處理的問題是如何區分 OpenGL texture object、底層 storage 與每個 context 的 sampler view，而不虛構一個不存在的 State Tracker subclass。 gl_texture_object 負責 API object state 並持有 pipe_resource reference，sampler_views 則保存同一 storage 在各 context 中建立的 shader-visible view

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:915](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L915) 與 [Mesa: src/mesa/main/mtypes.h:981](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L981)，用來顯示 `struct gl_texture_object` 直接以 `pt` 持有 Gallium storage，`validated_first_level`／`validated_last_level` 記錄已整合的 mip 範圍，`validate_mutex` 則保護每個 context 延遲建立的 `sampler_views` container

```c
...
   /* The texture must include at levels [0..lastLevel] once validated:
    */
   GLuint lastLevel;

   unsigned Swizzle;
   unsigned SwizzleGLSL130;

   unsigned int validated_first_level;
   unsigned int validated_last_level;

   /* On validation any active images held in main memory or in other
    * textures will be copied to this texture and the old storage freed.
    */
   struct pipe_resource *pt;

   /* Protect modifications of the sampler_views array */
   simple_mtx_t validate_mutex;

   /* Container of sampler views (one per context) attached to this texture
    * object. Created lazily on first binding in context.
...
```

pt 是 texture storage 的 Gallium reference。 OpenGL texture object 的 Name、Target、Sampler、Attrib 與 completeness metadata 仍在同一 gl_texture_object。 State Tracker 不需要先 downcast 到私有子類別才能找到 storage，所有路徑都能直接讀 texObj->pt

validated_first_level 與 validated_last_level 記錄 storage 已涵蓋的 mipmap 範圍。 OpenGL 允許各 level 分別定義，State Tracker 驗證會在需要時把有效 image 集中到 pt。 因此 pt 表示目前供 Gallium 使用的整體 resource，不能簡化成「某一張 level 0 圖片的 pointer」

sampler_views 是每個 context 的 view container。 pipe_sampler_view 由 pipe_context 建立並可能包含 context-specific driver state，不能只在全域 texture object 放一個 view 供所有 context 共用。 validate_mutex 保護 container 替換與 view 更新，舊 container 還可能因其他執行緒讀取而延後釋放

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_texture.h:85](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.h#L85)。 `st_texture_object_const()` 的 identity cast 與 `st_get_texobj_resource()` 的 `texObj ? texObj->pt : NULL` 回傳路徑，用來核對 State Tracker 是否另有 texture subclass。 實際 storage 直接取自 `gl_texture_object::pt`

```c
static inline const struct gl_texture_image *
st_texture_image_const(const struct gl_texture_image *img)
{
   return (const struct gl_texture_image *) img;
}

static inline const struct gl_texture_object *
st_texture_object_const(const struct gl_texture_object *obj)
{
   return (const struct gl_texture_object *) obj;
}


static inline struct pipe_resource *
st_get_texobj_resource(struct gl_texture_object *texObj)
{
   return texObj ? texObj->pt : NULL;
}
```

st_texture_object_const 接收與回傳的都是 gl_texture_object pointer，cast 也是 identity cast。 st_get_texobj_resource 更直接回傳 texObj->pt。 若存在真正的 subclass，這裡通常會出現 container cast 或專用 struct 欄位，固定版本並沒有這種資料形狀

函式名稱保留 st_ 前綴，只表示 helper 位於 State Tracker 模組，不表示參數是一個 st_texture_object instance。 閱讀其他呼叫點時也應以 signature 為準。 例如 st_create_texture_sampler_view_from_stobj 的 stobj 是概念名稱，實際參數型態仍是 struct gl_texture_object *

以下程式碼來自 [Mesa: src/mesa/main/mtypes.h:2534](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2534) 與 [Mesa: src/mesa/main/mtypes.h:2566](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/mtypes.h#L2566)，用來顯示 `struct gl_renderbuffer` 同時保存 `texture` storage reference、by-value `surface` render-target view 與只在 mapping 期間有效的 `transfer`，`defined` 則記錄內容是否已由 rendering 路徑建立

```c
...
   struct pipe_resource *texture;
   enum pipe_format format_linear;
   enum pipe_format format_srgb;
   struct pipe_surface surface;
   GLboolean defined;        /**< defined contents? */

   struct pipe_transfer *transfer; /**< only used when mapping the resource */

   /**
    * Used only when hardware accumulation buffers are not supported.
    */
   bool software;
   void *data;
...
```

gl_renderbuffer::texture 是 storage，surface 是可嵌入的 render-target view state，transfer 則只在 mapping 時使用。 這些欄位位於 Mesa core 型態本身，因此後面的 framebuffer conversion 直接從 gl_renderbuffer 取得 resource 與 surface，不需要 st_renderbuffer subclass

明確辨認這個版本差異能避免兩種錯誤。 第一種是照舊文章尋找已移除的私有 struct，結果誤以為 resource 轉換藏在配置函式。 第二種是看到 st_ helper 名稱就畫出繼承關係。 原始結構顯示真正關係是 core object 直接持有 Gallium reference，再由 State Tracker helper 操作

#### 建立 texture resource

建立 texture storage 時，State Tracker 必須將 OpenGL target、format、mipmap 尺寸、layer、sample count、usage 與 bind requirement 轉成 pipe_resource template。 st_texture_create 的操作對象是 stack 上的 pipe_resource pt。 它不把 pt 本身當成 storage，而是將它交給 pipe_screen::resource_create，取得由 driver 配置且帶 refcount 的新 resource

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_texture.c:55](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L55)，用來顯示 `st_texture_create()` 接收已轉成 Gallium 的 target、format 與尺寸，這一段檢查內部不變量：cube texture 必須有 6 layers，所有維度大於零，而且 `screen->is_format_supported()` 必須允許 `PIPE_BIND_SAMPLER_VIEW`

```c
struct pipe_resource *
st_texture_create(struct st_context *st,
                  enum pipe_texture_target target,
                  enum pipe_format format,
                  GLuint last_level,
                  GLuint width0,
                  GLuint height0,
                  GLuint depth0,
                  GLuint layers,
                  GLuint nr_samples,
                  unsigned flags,
                  GLuint bind,
                  bool sparse,
                  uint32_t compression)
{
   struct pipe_resource pt, *newtex;
   struct pipe_screen *screen = st->screen;

   assert(target < PIPE_MAX_TEXTURE_TYPES);
   assert(width0 > 0);
   assert(height0 > 0);
   assert(depth0 > 0);
   if (target == PIPE_TEXTURE_CUBE)
      assert(layers == 6);

   DBG("%s target %d format %s last_level %d\n", __func__,
       (int) target, util_format_name(format), last_level);

   assert(format);
   assert(screen->is_format_supported(screen, format, target, 0, 0,
                                      PIPE_BIND_SAMPLER_VIEW));
...
}
```

`st_texture_create()` 的參數已是 Gallium enum 與尺寸形狀，表示 OpenGL target 與 internal format 的大部分選擇在呼叫端或更早的 format helper 完成。 此函式仍驗證 target 範圍、正尺寸與 cube layer 數，並透過 `screen->is_format_supported` 確認至少可建立 sampler view。 這些 assert 是內部不變量，公開 API 錯誤應在更上層完成

screen 取自 st->screen，與建立 context 時的 pipe->screen 相同。 resource_create 是 screen 級 callback，因為 resource 可能由多個 context 引用或共享，建立責任不屬於 current pipe_context。 st_texture_create 雖屬 State Tracker，實際 storage policy 仍由選定的 pipe_screen 實作

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_texture.c:87](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L87)，用來顯示 `st_texture_create()` 在此將參數寫入零初始化的 `pipe_resource` template，`sparse` 會加上 `PIPE_RESOURCE_FLAG_SPARSE`，最後由 `screen->resource_create()` 建立 reference 已初始化的 `newtex`

```c
struct pipe_resource *
st_texture_create(struct st_context *st,
                  enum pipe_texture_target target,
                  enum pipe_format format,
                  GLuint last_level,
                  GLuint width0, GLuint height0, GLuint depth0,
                  GLuint layers, GLuint nr_samples,
                  unsigned flags, GLuint bind, bool sparse,
                  uint32_t compression)
{
...
   memset(&pt, 0, sizeof(pt));
   pt.target = target;
   pt.format = format;
   pt.last_level = last_level;
   pt.width0 = width0;
   pt.height0 = height0;
   pt.depth0 = depth0;
   pt.array_size = layers;
   pt.usage = PIPE_USAGE_DEFAULT;
   pt.bind = bind;
   /* only set this for OpenGL textures, not renderbuffers */
   pt.flags = PIPE_RESOURCE_FLAG_TEXTURING_MORE_LIKELY;
   pt.nr_samples = nr_samples;
   pt.nr_storage_samples = nr_samples;
   pt.compression_rate = compression;

   if (sparse)
      pt.flags |= PIPE_RESOURCE_FLAG_SPARSE;

   newtex = screen->resource_create(screen, &pt);

   assert(!newtex || pipe_is_referenced(&newtex->reference));

   return newtex;
}
```

memset 先讓未指定欄位為零，接著逐項填入 storage identity。 width0、height0、depth0 與 array_size 分開，對 array texture 與 3D texture 尤其重要。 last_level 描述配置的 mipmap 上界，nr_samples 與 nr_storage_samples 初始相同，compression_rate 則攜帶固定壓縮需求

bind 描述 resource 將來必須支援的用途集合，並非 current binding。 sampler view、render target、depth stencil 或其他用途會影響 driver 選擇 tiling、layout 與配置方式。 PIPE_RESOURCE_FLAG_TEXTURING_MORE_LIKELY 只為 OpenGL texture 設定，註解明確排除 renderbuffer，讓 driver 有額外的 usage hint

resource_create 讀取 stack template，但回傳的是另一個 pipe_resource pointer newtex。 template 的 reference 欄位不成為 storage ownership。 assert 檢查成功結果已有有效 reference，呼叫端之後再將 newtex 放入 gl_texture_object::pt 或 gl_texture_image 的對應欄位

State Tracker 到此只描述需求，沒有直接配置 driver 私有 storage。 這是 screen contract 的價值。 不同 driver 可用不同 backing store 與 layout，只要回傳的 pipe_resource 遵守共用欄位與 reference contract，上層 texture object 不需要知道細節

#### Map 產生 pipe_transfer

CPU map 除了取得位址，呼叫端還需要保存實際映射的 resource、level、box、usage、stride 與 layer stride，才能在 flush region 或 unmap 時引用同一次 transfer。 st_texture_image_map 先將 OpenGL image、face、level 與 immutable layer offset 正規化，再呼叫 pipe_texture_map_3d。 callback 透過輸出參數回傳 pipe_transfer，State Tracker 將它掛回 texture image

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_texture.c:289](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L289)，用來顯示 `st_texture_image_map()` 先確定 `stImage->pt` 存在，再回答 map level 應以哪個 storage 為基準：image resource 與 `stObj->pt` 不同時使用 level 0，相同時才沿用 `stImage->Level`

```c
GLubyte *
st_texture_image_map(struct st_context *st, struct gl_texture_image *stImage,
                     enum pipe_map_flags usage,
                     GLuint x, GLuint y, GLuint z,
                     GLuint w, GLuint h, GLuint d,
                     struct pipe_transfer **transfer)
{
   struct gl_texture_object *stObj = stImage->TexObject;
   GLuint level;
   void *map;

   DBG("%s \n", __func__);

   if (!stImage->pt)
      return NULL;

   if (stObj->pt != stImage->pt)
      level = 0;
   else
      level = stImage->Level;
...
}
```

`stImage->pt` 是這次要 map 的實際 resource。 它可能與 texture object 統整後的 `stObj->pt` 相同，也可能仍是獨立 image storage。 若兩者不同，該 image resource 的 level 以零計算。 若相同，才使用 OpenGL image 的 `Level`。 這個分支防止將 object 內的 mipmap index 錯套到只含單一 image 的 resource

usage 使用 PIPE_MAP_* flags，已把 OpenGL map request 轉成 Gallium usage。 transfer 是雙重 pointer，driver 會同時回傳 mapped 位址並建立對應 metadata object。 State Tracker 呼叫端後續保存位址與 transfer，讓 flush／unmap 能引用同一次 mapping

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_texture.c:309](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L309)，用來顯示 `st_texture_image_map()` 對 immutable view 加上 `MinLevel`／`MinLayer`，再把 cube `Face` 併入 z 座標。 `pipe_texture_map_3d()` 成功後才以 `st_texture_image_insert_transfer()` 保存 `*transfer`，讓後續 unmap 能找回同一筆 mapping

```c
GLubyte *
st_texture_image_map(struct st_context *st,
                     struct gl_texture_image *stImage,
                     enum pipe_map_flags usage,
                     GLuint x, GLuint y, GLuint z,
                     GLuint w, GLuint h, GLuint d,
                     struct pipe_transfer **transfer)
{
...
   if (stObj->Immutable) {
      level += stObj->Attrib.MinLevel;
      z += stObj->Attrib.MinLayer;
      if (stObj->pt->array_size > 1)
         d = MIN2(d, stObj->Attrib.NumLayers);
   }

   z += stImage->Face;

   map = pipe_texture_map_3d(st->pipe, stImage->pt, level, usage,
                              x, y, z, w, h, d, transfer);

   if (map)
      st_texture_image_insert_transfer(stImage, z, *transfer);

   return map;
}
```

Immutable storage view 可能從 resource 的非零 MinLevel 或 MinLayer 開始，因此 level 與 z 必須加上 view offset。 cube face 也折入 z。 最終的 x、y、z、w、h 與 d 都已轉成 pipe resource 座標，driver callback 不必再查 gl_texture_object 才能解釋範圍

map 成功時，st_texture_image_insert_transfer 以 slice 保存 transfer。 同一 texture image 的不同 face 或 layer 可能各有 mapping，insert 讓 unmap 路徑能以 image 與 slice 找回正確 transfer。 map 失敗則不插入任何 metadata，呼叫端取得 NULL

以下程式碼來自 [Mesa: src/gallium/auxiliary/util/u_inlines.h:670](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/util/u_inlines.h#L670)。 `pipe_texture_map_3d()` 將 x、y、z、w、h、d 組成 by-value `pipe_box`，隨即呼叫 `context->texture_map()`。 要觀察的輸出除了 mapped pointer，還有 driver 寫入的 `pipe_transfer **transfer` 與其中的實際 stride

```c
/**
 * Map a 3D (texture) resource for reading/writing.
 * \param access  bitmask of PIPE_MAP_x flags
 */
static inline void *
pipe_texture_map_3d(struct pipe_context *context,
                    struct pipe_resource *resource,
                    unsigned level,
                    unsigned access,
                    unsigned x, unsigned y, unsigned z,
                    unsigned w, unsigned h, unsigned d,
                    struct pipe_transfer **transfer)
{
   struct pipe_box box;
   u_box_3d(x, y, z, w, h, d, &box);
   return context->texture_map(context, resource, level, access,
                               &box, transfer);
}
```

helper 只會將六個座標組成 pipe_box，再呼叫 pipe_context::texture_map。 resource 與 level 保持分開，access 也原樣傳下。 driver 回傳位址並填入 transfer，transfer 中的 stride 不必等同於 width 乘 texel size，因為底層 layout 可能需要 staging 或其他轉換

這條資料流分清三種 identity。 pipe_resource 表示 storage，pipe_box 表示本次 request 的區域，pipe_transfer 表示一次 active mapping。 map pointer 只是 CPU 可存取的位址。 unmap 與顯式 flush region 應使用 transfer，而不是重新從 pointer 推回 resource 與範圍

#### Sampler view 建立與 binding

shader 不能只拿 pipe_resource 就開始取樣。 view 還要指定 format、target、mipmap level、layer 範圍與 component swizzle。 st_create_texture_sampler_view_from_stobj 從 gl_texture_object 建立 pipe_sampler_view template，再呼叫 pipe_context::create_sampler_view。 update_textures 收集目前 stage 所需 views，計算需要解除的舊 slot，最後呼叫 set_sampler_views

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_sampler_view.c:509](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_sampler_view.c#L509)，用來顯示 `st_create_texture_sampler_view_from_stobj()` 建立 driver view 前先決定可見範圍：`level_override`／`layer_override` 固定單一 slice，否則由 texture attributes 算出 first／last levels 與 layers，再填 swizzle、target 並呼叫 `create_sampler_view()`

```c
static struct pipe_sampler_view *
st_create_texture_sampler_view_from_stobj(struct st_context *st,
                                          struct gl_texture_object *texObj,
                                          enum pipe_format format,
                                          bool glsl130_or_later)
{
...
   templ.format = format;
   templ.is_tex2d_from_buf = false;

   if (texObj->level_override >= 0) {
      templ.u.tex.first_level = templ.u.tex.last_level = texObj->level_override;
   } else {
      templ.u.tex.first_level = texObj->Attrib.MinLevel +
                                texObj->Attrib.BaseLevel;
      templ.u.tex.last_level = last_level(texObj);
   }
   if (texObj->layer_override >= 0) {
      templ.u.tex.first_layer = templ.u.tex.last_layer = texObj->layer_override;
   } else {
      templ.u.tex.first_layer = texObj->Attrib.MinLayer;
      templ.u.tex.last_layer = last_layer(texObj);
   }
   assert(templ.u.tex.first_layer <= templ.u.tex.last_layer);
   assert(templ.u.tex.first_level <= templ.u.tex.last_level);
   templ.u.tex.min_lod_clamp = 0.0f;
   templ.target = gl_target_to_pipe(texObj->Target);

   templ.swizzle_r = GET_SWZ(swizzle, 0);
   templ.swizzle_g = GET_SWZ(swizzle, 1);
   templ.swizzle_b = GET_SWZ(swizzle, 2);
   templ.swizzle_a = GET_SWZ(swizzle, 3);

   templ.astc_decode_format =
      gl_astc_decode_precision_to_pipe(texObj->AstcDecodePrecision);

   return st->pipe->create_sampler_view(st->pipe, texObj->pt, &templ);
}
```

`level_override` 與 `layer_override` 欄位讓特殊 view 固定到單一 level 或 layer，一般路徑則從 texture attrib 的 `MinLevel`、`BaseLevel`、`MinLayer` 與 completeness 結果計算範圍。 assert 保證 first 不大於 last，driver 因而可以把 template 視為已驗證的 Gallium view request

target 由 gl_target_to_pipe 轉換，swizzle 拆成四個 component 欄位。 format 是呼叫端已選定的 pipe format，可以與 resource 原始 format 形成相容 view。 這正是 resource 與 view 分離的用途。 同一 storage 可因 OpenGL format interpretation 或 sRGB decode state 建立不同 sampler view

create_sampler_view 是 pipe_context callback，因為 view 可能包含 context-specific driver descriptor。 resource 以 texObj->pt 傳入，driver 建立 view 時會依 contract 取得 resource reference。 回傳的 pipe_sampler_view 之後放入 texture object 的 per-context sampler view container

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_texture.c:342](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_texture.c#L342)，用來顯示 `update_textures()` 比對 `old_num_textures` 與本輪 `num_textures`，用 `num_unbind` 清掉尾端舊 slots，再更新 `st->state.num_sampler_views`。 若 `extra_sampler_views` 標記暫時 YUV views，binding 後另以 `sampler_view_release()` 交回 driver

```c
static void
update_textures(struct st_context *st,
                mesa_shader_stage shader_stage,
                const struct gl_program *prog)
{
   struct pipe_sampler_view *sampler_views[PIPE_MAX_SAMPLERS];
   struct pipe_context *pipe = st->pipe;
   unsigned extra_sampler_views = 0;
   unsigned num_textures =
      st_get_sampler_views(st, shader_stage, prog, sampler_views, &extra_sampler_views);

   unsigned old_num_textures = st->state.num_sampler_views[shader_stage];
   unsigned num_unbind = old_num_textures > num_textures ?
                            old_num_textures - num_textures : 0;

   pipe->set_sampler_views(pipe, shader_stage, 0, num_textures, num_unbind,
                           sampler_views);
   st->state.num_sampler_views[shader_stage] = num_textures;

   /* release YUV views back to driver */
   if (pipe->sampler_view_release) {
      u_foreach_bit (i, extra_sampler_views) {
         pipe->sampler_view_release(pipe, sampler_views[i]);
      }
   }
}
```

st_get_sampler_views 依 linked program 與目前 texture unit 收集該 stage 的 view。 num_textures 是這輪實際綁定數，old_num_textures 則是前一輪記在 st->state 的數量。 若新數量較少，num_unbind 告訴 driver 必須清掉尾端舊 slot，避免 shader 改變後仍殘留不可見的 resource reference

set_sampler_views 的 start slot 為零，接著傳入 bind count、unbind count 與 view 陣列。 State Tracker 在 callback 後更新 num_sampler_views，讓下一輪能正確計算差額。 這個 state 屬於 Gallium binding cache，不是 OpenGL texture unit 的權威資料

extra_sampler_views 是此次收集過程建立的暫時 view，例如多平面取樣需要的額外 view。 若 driver 提供 sampler_view_release callback，binding 後以 bitset 找出並釋放 frontend 暫時 reference。 正常 texture object view 仍由 container 與 pipe reference contract 管理

resource、transfer 與 sampler view 至此形成清楚分工。 resource 是可共享 storage，transfer 是一次 CPU mapping，sampler view 是 shader-visible interpretation。 gl_texture_object 直接持有 resource 與 view container，State Tracker 只在需要時建立或綁定 Gallium object，沒有額外 texture subclass 介入

### Framebuffer conversion

draw framebuffer atom 現在要把 OpenGL attachments 轉成 driver render targets。 Mesa core 提供 `gl_framebuffer` 與 `gl_renderbuffer` references，視窗系統 drawable 還可能因 resize／swap 改變 backing resource。 只有沿 frontend 驗證、`st_set_ws_renderbuffer_surface()` 與 `st_update_framebuffer_state()`，才能判斷哪個 stamp 觸發重建、`pipe_surface` 由誰 reference，以及 CSO cache 何時重送 framebuffer state

```callgraph
視窗系統 drawable 驗證
=================================================
[Mesa: src/mesa/state_tracker/st_manager.c:1146] st_api_make_current()
  │
  ├─ stdraw = st_framebuffer_reuse_or_create(st, stdrawi)
  ├─ if (stdrawi && !stdraw)
  │    └─ return false
  └─ st_framebuffer_validate(stdraw, st)
       // trigger：drawable stamp 或 attachment resource 已改變
       ↓
[Mesa: src/mesa/state_tracker/st_manager.c:196] st_set_ws_renderbuffer_surface()
  │
  ├─ rb->texture = pipe_resource reference
  ├─ rb->surface = pipe_surface reference
  └─ attachment size／format 更新到 gl_renderbuffer
       // handoff：winsys resource 與 render-target view
       ↓

Mesa State Tracker framebuffer atom
=================================================
[Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:111] st_update_framebuffer_state()
  │
  ├─ 逐一填入 framebuffer.cbufs[i] = renderbuffer->surface
  ├─ depth/stencil attachment 存入 framebuffer.zsbuf
  └─ framebuffer.width／height／samples 由 attachments 推導
       ↓
[Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:775] cso_set_framebuffer()
  │
  ├─ state 與 cached framebuffer 相同
  │    └─ 不重送 driver callback
  └─ state 已改變
       └─ pipe->set_framebuffer_state(pipe, fb)
            // 最終結果：pipe_context 綁定本次 draw 使用的 surfaces
```

drawable stamp 先決定是否需要換 backing resource，State Tracker 再把每個 attachment 轉成帶 reference 的 `pipe_surface`。 CSO cache 只在完整 framebuffer state 改變時呼叫 driver，因此 terminal binding 與本次 draw 使用的 surfaces 保持一致

#### Winsys renderbuffer surface

window framebuffer 的 storage 可能在 drawable resize、buffer swap 或 frontend 重新配置後改變，State Tracker 不能永久假設 gl_renderbuffer 指向同一 pipe_resource。 st_framebuffer_validate 以 drawable stamp 判斷是否需要重新取得 attachment。 frontend validate 回傳 resources 後，st_set_ws_renderbuffer_surface 直接更新 gl_renderbuffer 的內嵌 pipe_surface、format、resource reference 與尺寸

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_manager.c:231](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L231)，用來顯示 `st_framebuffer_validate()` 以 `drawable_stamp == new_stamp` 作為無須更新的早退條件。 stamp 改變時呼叫 `drawable->validate()` 填入 `textures`，並在 callback 後重讀 stamp，直到取得同一世代的 attachments

```c
static void
st_framebuffer_validate(struct gl_framebuffer *stfb,
                        struct st_context *st)
{
...
   new_stamp = p_atomic_read(&stfb->drawable->stamp);
   if (stfb->drawable_stamp == new_stamp)
      return;

   memset(textures, 0, stfb->num_statts * sizeof(textures[0]));

   /* validate the fb */
   do {
      if (!stfb->drawable->validate(st, stfb->drawable, stfb->statts,
                                 stfb->num_statts, textures, &resolve))
         return;

      stfb->drawable_stamp = new_stamp;
      new_stamp = p_atomic_read(&stfb->drawable->stamp);
   } while(stfb->drawable_stamp != new_stamp);
...
}
```

stamp 未變時直接回傳，表示目前 `gl_renderbuffer` 仍對應 frontend 已驗證的 resource。 stamp 改變時，validate callback 依 `stfb->statts` 要求的 attachment 類型填入 `textures` 陣列。 State Tracker 只認識 frontend 介面，不直接向 X server 查詢 buffer

do loop 在 callback 後再次讀 stamp。 若驗證同時遇到另一輪 drawable 改變，程式會重試，直到取得的 resources 與穩定 stamp 配對。 這防止 resize 期間把不同世代的 width、height 與 attachment storage 組在同一 framebuffer

textures 中每個 resource 都帶 reference。 st_framebuffer_validate 會將它轉成對應 attachment 的 surface，再釋放暫時 reference。 resolve resource 也以明確的 reference replacement 保存。 frontend 與 State Tracker 因而透過 pipe_resource ownership contract 交換 drawable storage

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_manager.c:195](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L195)，用來顯示 `st_set_ws_renderbuffer_surface()` 以 `rb->surface = *surf` 複製 view metadata，依 `util_format_is_srgb()` 更新對應 format，透過 `pipe_resource_reference()` 替換 `rb->texture`，最後由 surface 寫回 renderbuffer 尺寸

```c
void
st_set_ws_renderbuffer_surface(struct gl_renderbuffer *rb,
                               struct pipe_surface *surf)
{
   rb->surface = *surf;

   if (util_format_is_srgb(surf->format))
      rb->format_srgb = surf->format;
   else
      rb->format_linear = surf->format;

   pipe_resource_reference(&rb->texture, surf->texture);
   rb->Width = pipe_surface_width(surf);
   rb->Height = pipe_surface_height(surf);
}
```

`rb->surface = *surf` 建立 by-value 副本，與前一節 `gl_renderbuffer` 定義中的 `struct pipe_surface surface` 相符。 這裡沒有配置 `st_renderbuffer`，也沒有將 `gl_renderbuffer` downcast。 surface 內含 texture reference、format、level 與 layer range 等 view metadata

format 依 sRGB 與 linear 分開保存。 framebuffer 後續會依 OpenGL enable state 選擇 _mesa_renderbuffer_get_format 的結果，但 storage surface 原始 format 必須先記錄。 同一 renderbuffer 因而能保留可用的 linear 與 sRGB interpretation

pipe_resource_reference 不是普通 pointer 賦值。 它先解除 rb->texture 的舊 reference，再取得 surf->texture 的新 reference。 renderbuffer 自此擁有 storage reference，即使 frontend validate 回傳的暫時 textures entry 稍後釋放，rb->texture 仍保持有效

Width 與 Height 從 surface helper 推得，不直接使用 resource width0。 surface 可能選擇非零 mipmap level，實際 attachment 尺寸要依 view level 計算。 更新後的 gl_renderbuffer 尺寸再供 Mesa core framebuffer resize 與 completeness state 使用

#### GL attachment 轉成 pipe_surface

draw framebuffer atom 必須將 Mesa core 的 color draw buffers、depth attachment、stencil attachment、sample count、layers 與 resolve resource 組成一份 pipe_framebuffer_state。 操作對象是 ctx->DrawBuffer 與其中直接持有 Gallium 欄位的 gl_renderbuffer。 st_update_framebuffer_state 先要求 window framebuffer 驗證，再逐 attachment 複製 pipe_surface，最後交給 CSO cache

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:110](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_framebuffer.c#L110)，用來顯示 `st_update_framebuffer_state()` 先以零初始化 stack `pipe_framebuffer_state`，呼叫 `st_manager_validate_framebuffers()` 更新 window attachments，接著使 bitmap／readpix caches 失效，並從 `gl_framebuffer` 推導 width、height、samples、layers 與 `resolve`

```c
void
st_update_framebuffer_state( struct st_context *st )
{
   struct gl_context *ctx = st->ctx;
   struct pipe_framebuffer_state framebuffer = {0};
   struct gl_framebuffer *fb = st->ctx->DrawBuffer;
   struct gl_renderbuffer *rb;
   GLuint i;

   /* Window framebuffer changes are received here. */
   st_manager_validate_framebuffers(st);

   st_flush_bitmap_cache(st);
   st_invalidate_readpix_cache(st);

   st->state.fb_orientation = _mesa_fb_orientation(fb);

   /**
    * Quantize the derived default number of samples:
    *
    * A query to the driver of supported MSAA values the
    * hardware supports is done as to legalize the number
    * of application requested samples, NumSamples.
    * See commit eb9cf3c for more information.
    */
   fb->DefaultGeometry._NumSamples =
      framebuffer_quantize_num_samples(st, fb->DefaultGeometry.NumSamples);

   framebuffer.width  = _mesa_geometric_width(fb);
   framebuffer.height = _mesa_geometric_height(fb);
   framebuffer.samples = _mesa_geometric_samples(fb);
   framebuffer.layers = _mesa_geometric_layers(fb);
   framebuffer.resolve = fb->resolve;
...
}
```

`pipe_framebuffer_state` 是 stack value，先以零初始化，防止未使用 attachment 留下垃圾 pointer。 `st_manager_validate_framebuffers()` 讓 window attachment 更新到最新 generation。 bitmap 與 readpix cache 也在 framebuffer 改變時處理，避免舊 framebuffer content 或 orientation 殘留

width、height、samples 與 layers 來自 Mesa core 已推導的 geometric state。 預設 sample count 先依 screen capability quantize，State Tracker 才將合法值交給 Gallium。 resolve resource 則來自前一節 frontend 驗證的 reference

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:144](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_framebuffer.c#L144)，用來顯示 `st_update_framebuffer_state()` 逐一讀取 `fb->_ColorDrawBuffers[i]`，只有 `rb && rb->texture` 才複製 `rb->surface`、覆寫目前 format 並將 `rb->defined` 設為 `GL_TRUE`。 空 attachment 對應的 `cbufs[i]` 會整份清零

```c
void
st_update_framebuffer_state(struct st_context *st)
{
...
   /* Examine Mesa's ctx->DrawBuffer->_ColorDrawBuffers state
    * to determine which surfaces to draw to
    */
   framebuffer.nr_cbufs = fb->_NumColorDrawBuffers;

   framebuffer.pls_enabled = ctx->PixelLocalStorage;

   unsigned num_multiview_layer = 0;
   for (i = 0; i < fb->_NumColorDrawBuffers; i++) {
      rb = fb->_ColorDrawBuffers[i];

      if (rb && rb->texture) {
         if (rb->is_rtt || _mesa_is_format_srgb(rb->Format)) {
            /* rendering to a GL texture, may have to update surface */

            _mesa_update_renderbuffer_surface(ctx, rb);

            num_multiview_layer = MAX2(num_multiview_layer, rb->rtt_numviews);
         }

         framebuffer.cbufs[i] = rb->surface;
         framebuffer.cbufs[i].format = _mesa_renderbuffer_get_format(ctx, rb);
         update_framebuffer_size(&framebuffer, &rb->surface);
         rb->defined = GL_TRUE; /* we'll be drawing something */
      } else {
         memset(&framebuffer.cbufs[i], 0, sizeof(framebuffer.cbufs[i]));
      }
   }
...
}
```

`fb->_ColorDrawBuffers` 已由 Mesa core 解析 DrawBuffers state，因此 loop 不必重新解釋 GL enum。 attachment 存在且 `rb->texture` 有效時，render-to-texture 或 sRGB 情況可能先更新 surface，接著直接將 `rb->surface` 複製到 `framebuffer.cbufs[i]`

format 在複製後以 `_mesa_renderbuffer_get_format` 覆寫，讓目前 OpenGL sRGB interpretation 反映到 pipe surface。 `update_framebuffer_size` 依實際 surface 收斂 framebuffer 尺寸。 `defined` 設為 true，因為下一次 draw 可能寫入 attachment

attachment 缺少 resource 時對應 cbuf 清零。 loop 後函式還會清除陣列中未使用的尾端 slot，並移除 trailing GL_NONE draw buffers。 driver 收到的 nr_cbufs 與 cbufs 因而是一份緊密且沒有舊 reference 的 state

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:183](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_framebuffer.c#L183)，用來顯示同一個 `st_update_framebuffer_state()` 對 depth／stencil 先取 `BUFFER_DEPTH`，缺少時才改取 `BUFFER_STENCIL`。 有效 resource 會成為 `framebuffer.zsbuf`，缺少則清零，最後以 bind flags asserts 驗證 attachments 並呼叫 `cso_set_framebuffer()`

```c
void
st_update_framebuffer_state(struct st_context *st)
{
...
   /*
    * Depth/Stencil renderbuffer/surface.
    */
   rb = fb->Attachment[BUFFER_DEPTH].Renderbuffer;
   if (!rb)
      rb = fb->Attachment[BUFFER_STENCIL].Renderbuffer;

   if (rb && rb->texture) {
      if (rb->is_rtt) {
         /* rendering to a GL texture, may have to update surface */
         _mesa_update_renderbuffer_surface(ctx, rb);
         num_multiview_layer = MAX2(num_multiview_layer, rb->rtt_numviews);
      }
      framebuffer.zsbuf = rb->surface;
      framebuffer.zsbuf.format = rb->texture->format;
      update_framebuffer_size(&framebuffer, &rb->surface);
   } else {
      memset(&framebuffer.zsbuf, 0, sizeof(framebuffer.zsbuf));
   }

   framebuffer.viewmask = (uint8_t)BITFIELD_MASK(num_multiview_layer);

#ifndef NDEBUG
   /* Make sure the resource binding flags were set properly */
   for (i = 0; i < framebuffer.nr_cbufs; i++) {
      assert(!framebuffer.cbufs[i].texture ||
             framebuffer.cbufs[i].texture->bind & PIPE_BIND_RENDER_TARGET);
   }
   if (framebuffer.zsbuf.texture) {
      assert(framebuffer.zsbuf.texture->bind & PIPE_BIND_DEPTH_STENCIL);
   }
#endif

   cso_set_framebuffer(st->cso_context, &framebuffer);
...
}
```

`BUFFER_DEPTH` attachment 優先，沒有時才取 `BUFFER_STENCIL` attachment。 packed depth stencil 通常由同一 renderbuffer 表示，因此一個 `zsbuf` surface 即可。 resource 存在時複製 `rb->surface`，format 則使用 resource format。 缺少 attachment 時整個 `zsbuf` 清零

debug assert 檢查 color resource 具備 PIPE_BIND_RENDER_TARGET，depth stencil resource 具備 PIPE_BIND_DEPTH_STENCIL。 這些 bind flags 在 resource_create 時已參與 layout 選擇，此處只驗證上層未將用途不相容的 storage 放入 framebuffer

最後呼叫 cso_set_framebuffer，而不是直接呼叫 pipe->set_framebuffer_state。 State Tracker 已完成 OpenGL attachment 到 pipe surface 陣列的轉換，CSO 層接著判斷這份 state 是否真的與 current binding 不同

#### CSO cache 避免重複 framebuffer state

framebuffer atom 可能因相依 state 或 drawable stamp 多次執行，但結果不一定改變。 cso_set_framebuffer 的操作對象是完整 pipe_framebuffer_state value。 它以 memcmp 比較 cache 中的 ctx->fb，只有不同時才複製 reference-safe state，並呼叫 pipe_context::set_framebuffer_state

以下程式碼來自 [Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:774](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/cso_cache/cso_context.c#L774)，用來顯示 `cso_set_framebuffer()` 以 `memcmp(&ctx->fb, fb, sizeof(*fb))` 判斷完整 framebuffer state 是否改變，只有不同時才用 `util_copy_framebuffer_state()` 更新帶 reference 的 cache，並呼叫 `pipe->set_framebuffer_state()`

```c
void
cso_set_framebuffer(struct cso_context *cso,
                    const struct pipe_framebuffer_state *fb)
{
   struct cso_context_priv *ctx = (struct cso_context_priv *)cso;

   if (memcmp(&ctx->fb, fb, sizeof(*fb)) != 0) {
      util_copy_framebuffer_state(&ctx->fb, fb);
      ctx->base.pipe->set_framebuffer_state(ctx->base.pipe, fb);
   }
}
```

memcmp 可用是因為 State Tracker 先將 stack struct 整份清零，再填入有效欄位。 未使用 padding 或 attachment slot 若含未初始化資料，就可能讓語意相同的 state 比較為不同。 前一節的初始化與尾端 slot 清理因此也支援 CSO cache 的穩定比較

`util_copy_framebuffer_state` 執行 reference-aware 複製，不是普通 assignment。 `pipe_framebuffer_state` 內的 surface 與 resolve resource 帶 reference，複製 helper 會正確更新 cache ownership。 cache 保存的是可長期比較的 state，而呼叫端的 stack framebuffer 在 `st_update_framebuffer_state` 回傳後即可消失

只有 memcmp 不同時才呼叫 driver callback。 這避免重複 framebuffer bind，也避免 driver 重建相同 render target descriptor。 atom dirty 表示上游某項輸入可能改變，CSO 比較則確認轉換後的 Gallium state 是否真的改變，兩層過濾處理的是不同問題

此處也再次證明 cso_context 與 pipe_context 的關係。 ctx->base.pipe 是建立 CSO cache 時傳入的同一 pipe，CSO 不執行 draw 或 resource 配置。 它只保存 state reference，必要時轉呼叫原 pipe callback

### Clear 與 readback 的 operation-specific state

draw 以完整 rendering pipeline mask 更新 state，clear 與 readback 則只需要其中一部分。 `st_Clear()` 依 clear 所需的 framebuffer、scissor 與 window 矩形 state 選擇清除方法。 `st_ReadPixels()` 只先確認 read framebuffer 對應的 resource 已更新，再進入 staging、mapping 與 pixel conversion

#### Clear-specific atoms 與 clear method

`st_Clear()` 還要跑 clear-specific atoms。 mask 只含 framebuffer、scissor 與 window 矩形。 State Tracker 再依 format 與 scissor state，也考量 write masks，判斷使用 `pipe_context::clear` 或 quad-based clear。 core derived state 仍先於 atoms materialization

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_cb_clear.c:395](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_clear.c#L395-415) 與 [Mesa: src/mesa/state_tracker/st_cb_clear.c:484](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_clear.c#L484-529) 的 `st_Clear()`，用來觀察 `clear_buffers` 與 `quad_buffers` 如何分流。 `ST_PIPELINE_CLEAR_STATE_MASK` 只驗證 clear atoms，兩個欄位分別交給 `pipe->clear()` 與 `clear_with_quad()`：

```c
void
st_Clear(struct gl_context *ctx, GLbitfield mask)
{
   struct st_context *st = st_context(ctx);
...
   /* This makes sure the pipe has the latest scissor, etc values */
   ST_PIPELINE_CLEAR_STATE_MASK(pipeline_mask);
   st_validate_state(st, pipeline_mask);
...
   if (clear_buffers) {
...
      st->pipe->clear(st->pipe, clear_buffers,
                      color_clear_mask, stencil_clear_mask,
                      have_scissor_buffers ? &scissor_state : NULL,
                      (union pipe_color_union*)&ctx->Color.ClearColor,
                      ctx->Depth.Clear, ctx->Stencil.Clear);
   }
   if (quad_buffers) {
      clear_with_quad(ctx, quad_buffers);
   }
...
}
```

`st_Clear()` 只以 `ST_PIPELINE_CLEAR_STATE_MASK` 驗證 clear 會消費的 atoms。 `clear_buffers` 非零時呼叫 `pipe->clear()`，`quad_buffers` 非零時則交給 `clear_with_quad()`。 兩個分支直接反映 attachment format、scissor 與 write-mask 分流後的實際 clear 方法

#### ReadPixels 的 framebuffer 驗證與 resource readback

State Tracker callback 只 validate `ST_NEW_FB_STATE`，確保 renderbuffer 的 current resource 與 surface view 已更新。 fast 路徑可 blit 到 staging resource、map `pipe_transfer`，再依 pack stride 複製

若 format conversion 或 driver capability 不適用，就退回 Mesa readpixels 路徑。 core 在兩條路之前都已完成 format legality、packing bounds 與 clipping

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_cb_readpixels.c:418](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_readpixels.c#L418-455) 的 `st_ReadPixels()`。 Callback 分支顯示函式先取得 format 對應的 read renderbuffer，只驗證 `ST_NEW_FB_STATE`，接著嘗試 blit／staging fast 路徑。 fallback 仍以 supplied pack state 與矩形 map source resource，因此 map 會處理先前 rendering 的 read hazard：

```c
void
st_ReadPixels(struct gl_context *ctx, GLint x, GLint y,
              GLsizei width, GLsizei height,
              GLenum format, GLenum type,
              const struct gl_pixelstore_attrib *pack,
              void *pixels)
{
   struct st_context *st = st_context(ctx);
   struct gl_renderbuffer *rb =
         _mesa_get_read_renderbuffer_for_format(ctx, format);
...
   if (rb == NULL)
      return;

   /* Validate state (to be sure we have up-to-date framebuffer surfaces)
    * and flush the bitmap cache prior to reading. */
   ST_PIPELINE_UPDATE_FB_STATE_MASK(mask);
   st_validate_state(st, mask);
   st_flush_bitmap_cache(st);
...
   /* This must be done after state validation. */
   src = rb->texture;
...
}
```

readback 的 map 必須看到 rendering 結果，因而可能造成 CPU 與 GPU synchronization。 這是 resource read hazard，不是 `glFlush()` 的 completion contract

### Draw、flush 與 finish

所有 draw atoms 已更新到 current `pipe_context`，application 現在需要執行 draw，之後可能呼叫 `glFlush()` 或 `glFinish()`。 必須分開看 `pipe_draw_info` 的 callback handoff、flush 是否要求 output fence，以及 finish 如何等待並釋放 fence reference，才能判斷「已提交」與「已完成」兩種同步結果。 這條路徑從 `st_draw_gallium()` 收斂到 `st_flush()` 與 `fence_finish`

```callgraph
Mesa State Tracker draw dispatch
=================================================
[Mesa: src/mesa/state_tracker/st_draw.c:75] st_prepare_draw()
  │
  ├─ if (!st->bitmap.cache.empty)
  │    └─ st_flush_bitmap_cache(st)
  ├─ st_validate_state(st, state_mask)
  └─ st_context_add_work(st)
       ↓
[Mesa: src/mesa/state_tracker/st_draw.c:93] st_draw_gallium()
  │
  └─ cso_draw_vbo(st->cso_context, info, ..., draws, num_draws)
       // handoff：pipe_draw_info + draw ranges + bound Gallium state
       ↓
[Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:269] cso_draw_vbo_default()
  │
  ├─ if (pipe->vbuf)
  │    └─ u_vbuf_draw_vbo(...)
  └─ else
       └─ pipe->draw_vbo(...)
            // 最終結果：選定 driver 消費 draw request

Mesa State Tracker flush
=================================================
[Mesa: src/mesa/state_tracker/st_manager.c:784] st_context_flush()
  │
  ├─ notify_before_flush_cb != NULL
  │    └─ callback(st, data)
  └─ st_flush(st, fence, pipe_flags)
       ↓
[Mesa: src/mesa/state_tracker/st_cb_flush.c:51] st_flush()
  │
  ├─ 先提交 Mesa buffered vertices／bitmap work
  └─ st->pipe->flush(st->pipe, fence, flags)
       // fence slot 為 NULL 時，只要求 driver 推進工作
       // fence slot 非 NULL 時，driver 可回傳 pipe_fence_handle reference

Mesa OpenGL finish wait
=================================================
[Mesa: src/mesa/state_tracker/st_cb_flush.c:71] st_finish()
  │
  │  st_flush(st, &fence, PIPE_FLUSH_ASYNC | PIPE_FLUSH_HINT_FINISH);
  ├─ if (fence)
  │    ├─ [Mesa: src/mesa/state_tracker/st_manager.c:809]
  │    │  screen->fence_finish(screen, NULL, fence, OS_TIMEOUT_INFINITE)
  │    └─ screen->fence_reference(screen, &fence, NULL)
  └─ fence == NULL
       └─ driver 的 Finish flush contract 必須已完成等待
            // 最終結果：glFinish 可觀察到先前 rendering work 已完成
```

draw callback 消費已驗證的 state，flush 將累積工作推進 execution 路徑並可回傳 fence，finish 則借由該 fence 觀察 completion。 三個入口共用 `pipe_context`／`pipe_screen` contract，但對呼叫端提供不同的同步保證

#### Draw dispatch

draw dispatch 的前提是 `st_prepare_draw()` 已將所有必要 atom 更新到 `pipe_context`。 `st_init_draw_functions()` 先將 Mesa core 的 `DrawGallium` slot 設成 `st_draw_gallium()`

callback 執行時不再讀取 OpenGL texture unit 或 framebuffer attachment，也不重新驗證 state。 它只取得 `st_context`，將 `pipe_draw_info`、indirect info 與 draw range 交給 `cso_draw_vbo()`。 CSO helper 檢查 draw argument 不變量，再依 vertex buffer fallback state 呼叫最終 draw callback

以下片段依序來自 [Mesa: src/mesa/state_tracker/st_draw.c:92](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_draw.c#L92-105) 的 `st_draw_gallium()` 與 [Mesa: src/mesa/state_tracker/st_draw.c:243](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_draw.c#L243-250) 的 `st_init_draw_functions()`。 前者從 `gl_context` 找回 `st_context`，直接將 borrowed descriptors 交給 CSO。 後者則建立 `Driver.DrawGallium` 到這個 callback 的對應：

```c
void
st_draw_gallium(struct gl_context *ctx,
                const struct pipe_draw_info *info,
                unsigned drawid_offset,
                const struct pipe_draw_indirect_info *indirect,
                const struct pipe_draw_start_count_bias *draws,
                unsigned num_draws)
{
   MESA_TRACE_FUNC();

   struct st_context *st = st_context(ctx);

   cso_draw_vbo(st->cso_context, info, drawid_offset, indirect, draws, num_draws);
}

void
st_init_draw_functions(struct pipe_screen *screen,
                       struct dd_function_table *functions)
{
   ...
   functions->DrawGallium = st_draw_gallium;
   functions->DrawGalliumMultiMode = st_draw_gallium_multimode;
   ...
}
```

`st_init_draw_functions()` 在 context 初始化期間安裝 callback。 draw 到達這裡時，`ctx` 只用來找回 `st_context`，真正 dispatch 對象是 `st->cso_context`。 `info` 描述 primitive mode、index size、instance count 與其他 draw metadata，`draws` 則描述 start、count 與 index bias。 多筆 draw 共用 info 時，`num_draws` 表示 draws 陣列長度

函式沒有呼叫 st_validate_state，因為呼叫端在 DrawGallium 前已執行 st_prepare_draw。 這項 contract 讓不同 Mesa core draw 入口共用驗證，而 st_draw_gallium 專注 Gallium dispatch。 若將驗證重複放進此函式，multi draw 與特殊 draw 路徑可能多做一輪 atom update

以下程式碼來自 [Mesa: src/gallium/auxiliary/cso_cache/cso_context.h:232](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/cso_cache/cso_context.h#L232)，用來顯示 `cso_draw_vbo()` 以三個 asserts 排除 indirect buffer、stream-output count 與 indexed draw 的非法組合，並要求 indirect 路徑的 `num_draws == 1`，asserts 成立後才轉呼叫已註冊的 `cso->draw_vbo(cso->pipe, ...)`

```c
static ALWAYS_INLINE void
cso_draw_vbo(struct cso_context *cso,
             const struct pipe_draw_info *info,
             unsigned drawid_offset,
             const struct pipe_draw_indirect_info *indirect,
             const struct pipe_draw_start_count_bias *draws,
             unsigned num_draws)
{
   /* We can't have both indirect drawing and SO-vertex-count drawing */
   assert(!indirect ||
          indirect->buffer == NULL ||
          indirect->count_from_stream_output == NULL);

   /* We can't have SO-vertex-count drawing with an index buffer */
   assert(info->index_size == 0 ||
          !indirect ||
          indirect->count_from_stream_output == NULL);

   /* Indirect only uses indirect->draw_count, not num_draws. */
   assert(!indirect || num_draws == 1);

   cso->draw_vbo(cso->pipe, info, drawid_offset, indirect, draws, num_draws);
}
```

三組 `assert` 分支確認 indirect draw、stream-output count 與 indexed draw 的組合符合 Gallium contract。 這些檢查屬於上游轉換完成後應成立的內部不變量，不處理 OpenGL error 驗證。 最後透過 `cso->draw_vbo` 函式指標 dispatch，底層 pipe 仍以 `cso->pipe` 傳入

以下程式碼來自 [Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:268](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/cso_cache/cso_context.c#L268)。 `cso_draw_vbo_default()` 顯示 vertex fallback 的實際分支：`pipe->vbuf` 存在時先走 `u_vbuf_draw_vbo()` 轉換 driver 不支援的 vertex fetch，否則直接進入 `pipe->draw_vbo()`

```c
static void
cso_draw_vbo_default(struct pipe_context *pipe,
                     const struct pipe_draw_info *info,
                     unsigned drawid_offset,
                     const struct pipe_draw_indirect_info *indirect,
                     const struct pipe_draw_start_count_bias *draws,
                     unsigned num_draws)
{
   if (pipe->vbuf)
      u_vbuf_draw_vbo(pipe, info, drawid_offset, indirect, draws, num_draws);
   else
      pipe->draw_vbo(pipe, info, drawid_offset, indirect, draws, num_draws);
}
```

`pipe->vbuf` 存在時，`u_vbuf` 分支先處理 driver 原生 vertex fetch 不支援的 buffer 或 format，再向同一 pipe 送出轉換後 draw。 不需要 fallback 時直接呼叫 `pipe->draw_vbo`。 State Tracker 不必在每次 draw 依 driver capability 重寫 vertex array，CSO 初始化已決定是否配置 `u_vbuf`

這裡是 driver draw contract 的清楚入口。 pipe->draw_vbo 之後如何記錄 command、執行軟體 rasterization 或安排 worker，屬於各 driver 實作。 State Tracker 到此已完成 OpenGL state 與 draw parameter 的轉換

#### Flush dispatch

flush 的問題是先排空 State Tracker 自己延遲的工作，再要求 pipe_context 提交截至目前的 command。 `st_glFlush()` 接住 OpenGL frontend 的非等待要求，`st_context_flush()` 則服務帶有 `ST_FLUSH_*` flags 的 frontend request。 兩條路最後都收斂到 `st_flush()` 與 `pipe->flush()`

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_cb_flush.c:50](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L50)，用來顯示 `st_flush()` 在 command submission 前先呼叫 `st_context_free_zombie_objects()` 與 `st_flush_bitmap_cache()`，然後才把可選的 `fence` output slot 與 `flags` 交給 `st->pipe->flush()`

```c
void
st_flush(struct st_context *st,
         struct pipe_fence_handle **fence,
         unsigned flags)
{
   MESA_TRACE_FUNC();

   /* We want to call this function periodically.
    * Typically, it has nothing to do so it shouldn't be expensive.
    */
   st_context_free_zombie_objects(st);

   st_flush_bitmap_cache(st);
   st->pipe->flush(st->pipe, fence, flags);
}
```

`st_context_free_zombie_objects()` 回收的 zombie shader 是已從上層生命週期移除、但先前可能因非同步工作而延後回收的 driver handle。 periodic flush 是適合清理它們的點。 此操作與 command submission 分開，但放在 pipe flush 前可避免長時間累積

bitmap cache 可能保存尚未向 pipe 送出的繪圖。 若直接 flush pipe 而不先處理 cache，OpenGL 呼叫端認為已 flush 的工作仍可能留在 State Tracker。 因此 st_flush_bitmap_cache 必須在 pipe->flush 前執行

fence 是可選輸出參數。 呼叫端傳入 NULL 時只要求提交，不取得同步 object。 呼叫端傳入 pipe_fence_handle 的雙重 pointer 時，driver 可以回傳代表這次 flush 進度的 opaque fence。 flags 則描述 end-of-frame、finish hint 或其他 Gallium flush 要求

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_cb_flush.c:89](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L89-102) 的 `st_glFlush()`。 OpenGL `glFlush()` 路徑將 fence output 固定為 `NULL`，因此 `st_flush()` 只推進 submission。 完成後再以 `st_manager_flush_frontbuffer()` 處理 front-buffer integration：

```c
void
st_glFlush(struct gl_context *ctx, unsigned gallium_flush_flags)
{
   struct st_context *st = st_context(ctx);
   ...
   st_flush(st, NULL, gallium_flush_flags);

   st_manager_flush_frontbuffer(st);
}
```

`fence = NULL` 讓這條路徑沒有可供等待的 completion object。 `st_glFlush()` 回傳時，driver 可以仍在執行已提交的工作。 front-buffer notification 也不會把這項 API contract 改成阻塞 wait

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_manager.c:783](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L783)，用來顯示 `st_context_flush()` 把 `ST_FLUSH_END_OF_FRAME`／`ST_FLUSH_FENCE_FD` 映射成 pipe flags，排空 bitmap 與 core vertices 後才在 `before_flush_cb != NULL` 時通知 frontend，最後以轉換後的 `pipe_flags` 呼叫 `st_flush()`

```c
void
st_context_flush(struct st_context *st, unsigned flags,
                 struct pipe_fence_handle **fence,
                 void (*before_flush_cb) (void*), void* args)
{
   unsigned pipe_flags = 0;

   MESA_TRACE_FUNC();

   if (flags & ST_FLUSH_END_OF_FRAME)
      pipe_flags |= PIPE_FLUSH_END_OF_FRAME;
   if (flags & ST_FLUSH_FENCE_FD)
      pipe_flags |= PIPE_FLUSH_FENCE_FD;

   /* We can do these in any order because FLUSH_VERTICES will also flush
    * the bitmap cache if there are any unflushed vertices.
    */
   st_flush_bitmap_cache(st);
   FLUSH_VERTICES(st->ctx, 0, 0);

   /* Notify the caller that we're ready to flush */
   if (before_flush_cb)
      before_flush_cb(args);
   st_flush(st, fence, pipe_flags);
...
}
```

`ST_FLUSH_*` 與 `PIPE_FLUSH_*` flags 分屬不同介面，wrapper 明確映射可下放的語意。 `FLUSH_VERTICES` 處理 Mesa core 仍累積的 vertices，bitmap cache 則處理 State Tracker 特殊路徑。 兩者完成後，`before_flush_cb` 才收到「即將呼叫 pipe flush」的通知

before callback 位於 cache 排空與 pipe submission 之間，frontend 可在這個穩定點完成相關 bookkeeping。 st_flush 隨後接收轉換後的 pipe_flags。 若呼叫端只要求非阻塞 flush，函式到此不等待 driver 完成

flush 保證 command 已推進到 driver 定義的提交邊界。 finish 與 `ST_FLUSH_WAIT` 另外取得 fence 並等待，提供 GPU 或 worker completion guarantee

#### Finish 產生 fence 並等待

finish 必須在回傳前確認先前工作完成。 st_finish 以本地 fence pointer 呼叫 st_flush，加入 async 與 finish hint，然後在 pipe_screen 上無限期等待該 fence。 st_context_flush 的 wait flag 使用相同 reference 與 fence_finish contract。 等待後兩條路都解除 fence reference，避免同步 object 洩漏

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_cb_flush.c:67](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L67)，用來顯示 `st_finish()` 以 `PIPE_FLUSH_ASYNC | PIPE_FLUSH_HINT_FINISH` 要求 `st_flush()` 回傳 fence。 只有 `fence != NULL` 才以無限 timeout 呼叫 `screen->fence_finish()`，接著用 `fence_reference(..., NULL)` 解除 reference，最後無條件處理 swapbuffer bookkeeping

```c
/**
 * Flush, and wait for completion.
 */
void
st_finish(struct st_context *st)
{
   struct pipe_fence_handle *fence = NULL;

   MESA_TRACE_FUNC();

   st_flush(st, &fence, PIPE_FLUSH_ASYNC | PIPE_FLUSH_HINT_FINISH);

   if (fence) {
      st->screen->fence_finish(st->screen, NULL, fence,
                               OS_TIMEOUT_INFINITE);
      st->screen->fence_reference(st->screen, &fence, NULL);
   }

   st_manager_flush_swapbuffers();
}
```

PIPE_FLUSH_ASYNC 讓 flush callback 以 fence 表達尚未完成的工作，而不是在 callback 內強迫同步。 PIPE_FLUSH_HINT_FINISH 告訴 driver 呼叫端隨後會等待，driver 可選擇適合這種使用方式的 submission policy。 State Tracker 仍以回傳 fence 為同步依據

fence 可能為 NULL，表示 driver 已同步完成或該實作不需要 fence object。 非 NULL 時，fence_finish 接收 OS_TIMEOUT_INFINITE，直到工作完成才回傳。 context 參數在此為 NULL，顯示等待是 screen 級 fence operation，不必再經原 pipe_context dispatch

fence_reference 將本地 reference 設為 NULL。 這個 callback 處理 driver 私有 fence refcount，State Tracker 不知道實際 object 大小或釋放方式。 st_manager_flush_swapbuffers 最後處理與 swap 相關的 pending frontend bookkeeping

以下程式碼來自 [Mesa: src/mesa/state_tracker/st_manager.c:808](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L808)，用來顯示 `st_context_flush()` 的等待路徑要求 `(flags & ST_FLUSH_WAIT) && fence && *fence` 同時成立，才會將 `st->pipe` 傳給 `fence_finish()` 並釋放呼叫端的 fence reference。 `ST_FLUSH_FRONT` 則另行觸發 front-buffer 呈現

```c
void
st_context_flush(struct st_context *st, unsigned flags,
                 struct pipe_fence_handle **fence,
                 void (*before_flush_cb)(void *), void *args)
{
...
   if ((flags & ST_FLUSH_WAIT) && fence && *fence) {
      st->screen->fence_finish(st->screen, st->pipe, *fence,
                                     OS_TIMEOUT_INFINITE);
      st->screen->fence_reference(st->screen, fence, NULL);
   }

   if (flags & ST_FLUSH_FRONT)
      st_manager_flush_frontbuffer(st);
}
```

這條路徑只在呼叫端明確設定 ST_FLUSH_WAIT、提供 fence output 且 driver 實際回傳 fence 時等待。 與 st_finish 不同，fence_finish 的 context 參數是 st->pipe，讓 screen 實作在需要時知道相關 context。 completion contract 仍由同一個 pipe_screen callback 提供

等待完成後立即解除呼叫端 fence reference。 若 flags 另要求 front buffer flush，wrapper 再通知 frontend 顯示端整合。 這個動作不取代 fence wait，前者處理呈現邊界，後者處理 rendering completion

draw、flush 與 finish 因而形成三個不同 contract。 draw_vbo 消費已綁定的 pipe state 並記錄工作，flush 提交工作並可回傳 opaque fence，finish 則等待 fence completion。 State Tracker 負責順序與 ownership，實際 execution model 由 pipe callback 背後的 driver 決定

## Gallium3D

State Tracker 已把齒輪這一幀的 OpenGL-specific state 轉成 `pipe_screen`、`pipe_context`、resource、surface、view 與 draw description。 從這個交界開始，最後選到的 driver 會決定 work 在哪裡執行：softpipe 或 llvmpipe 讓 CPU 產生 pixels，實體 GPU driver 建立硬體 commands，VirGL 則把相同的 Gallium inputs 編成可提交的 virtual GPU command stream

要理解為什麼同一個齒輪 draw 能有不同落點，必須先讀 Gallium 本身的 callback 與 ownership contract。 Screen 負責 capabilities、resource factory 與跨 context 的 fence operations，context 保存有順序的 mutable rendering state，view／surface／transfer 則各自持有 storage reference。 這些 contracts 說清楚後，才能沿相同的 draw 與 flush inputs 比較軟體 renderer、硬體 driver 與 VirGL

### Screen 與 context contract

frontend 正要由一個 adapter-level object 建立 rendering context，之後所有 state changes 與 commands 都必須維持該 context 的順序。 要判斷 capability／resource factory 與 mutable draw state 的 owner，必須比較 `pipe_screen` 和 `pipe_context` callback tables：前者建立 contexts／resources 並等待 fences，後者綁定 state、map resources、draw 與 flush

```text
pipe_frontend_screen
  └─ pipe_screen
       ├─ screen-level capabilities
       ├─ context_create
       ├─ resource_create
       ├─ flush_frontbuffer
       └─ fence callbacks

pipe_screen::context_create()
  └─ pipe_context
       ├─ immutable-state create／bind／delete callbacks
       ├─ draw_vbo
       ├─ buffer／texture map 與 unmap
       └─ flush
```

#### Adapter／screen 級責任

pipe_screen 的責任是保存跨 context 共用的 capability 與 factory callback。 它不是 OpenGL context，也不保存某一筆 draw 的 binding。 State Tracker 透過 st_context::screen 查詢 caps、建立 resource 或等待 fence，DRI frontend 則將選定的 pipe_screen 放入 pipe_frontend_screen。 concrete driver 會配置包含 pipe_screen base 的私有 screen，並在建立時填入 callback table

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_screen.h:86](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L86)，用來顯示 `struct pipe_screen` 集中不需 rendering context 的 driver 資訊，這段要核對 `caps`、per-stage `shader_caps` 與 `nir_options` 如何成為 State Tracker 選擇 format、lowering 與 NIR 表示的 screen-level 依據

```c
/**
 * Gallium screen/adapter context.  Basically everything
 * hardware-specific that doesn't actually require a rendering
 * context.
 */
struct pipe_screen {
   int refcnt;
   void *winsys_priv;

   const struct pipe_caps caps;
   const struct pipe_shader_caps shader_caps[MESA_SHADER_MESH_STAGES];
   const struct pipe_compute_caps compute_caps;
   const struct nir_shader_compiler_options *nir_options[MESA_SHADER_MESH_STAGES];
...
```

caps 與 shader_caps 在 screen 建立時由 driver 填好，State Tracker 之後把它們當成唯讀 capability。 前一章的 atom lowering、format 選擇與 NIR lowering 都會讀這些欄位。 nir_options 也以 shader stage 為索引，讓 frontend 在交付 NIR 前選擇 driver 可接受的表示

refcnt 表示 screen 自己有獨立生命週期。 多個 pipe_context 可以指向同一 screen，resource 也在 pipe_resource::screen 留下所屬 screen。 winsys_priv 則讓 screen 實作保存與視窗系統或更低層整合相關的私有資料，上層不能解讀其內容

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_screen.h:190](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L190)，用來顯示 `pipe_screen::context_create` 明定 per-context factory 的三項輸入：所屬 `screen`、要放進 `pipe_context::priv` 的 borrowed `priv`，以及 `PIPE_CONTEXT_*` flags。 成功回傳的新 `pipe_context` 隨後由 `st_context::pipe` 保存

```c
...
   /**
    * Create a context.
    *
    * \param screen      pipe screen
    * \param priv        a pointer to set in pipe_context::priv
    * \param flags       a mask of PIPE_CONTEXT_* flags
    */
   struct pipe_context * (*context_create)(struct pipe_screen *screen,
                                           void *priv, unsigned flags);
...
```

State Tracker 呼叫端是 [Mesa: src/mesa/state_tracker/st_manager.c:1005](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L1005)。 `st_api_create_context()` 將 screen、priv 與 flags 傳入，取得新的 `pipe_context`。 成功回傳結果由 `st_context::pipe` 長期持有，失敗則在 Mesa core context 建立前回傳

concrete registration 可在 [Mesa: src/gallium/drivers/softpipe/sp_screen.c:460](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.c#L460) 找到。 softpipe 把 `base.context_create` 指向 `softpipe_create_context`。 factory handoff 結束於新 `pipe_context`，driver execution 從該 callback 另一側展開

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_screen.h:235](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L235)，用來顯示 `can_create_resource()` 只測試 template 的尺寸與總大小能否配置，`resource_create()` 才依同一份 `pipe_resource` template 建立實體 storage。 兩個 callbacks 的差別正是 proxy 驗證與新 owner reference 的分界

```c
...
   /**
    * Check if we can actually create the given resource (test the dimension,
    * overall size, etc).  Used to implement proxy textures.
    * \return TRUE if size is OK, FALSE if too large.
    */
   bool (*can_create_resource)(struct pipe_screen *screen,
                               const struct pipe_resource *templat);

   /**
    * Create a new texture object, using the given template info.
    */
   struct pipe_resource * (*resource_create)(struct pipe_screen *,
                                             const struct pipe_resource *templat);
...
```

State Tracker 呼叫端是 [Mesa: src/mesa/state_tracker/st_texture.c:106](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L106)。 它將 stack template 交給 resource_create，取得 refcount 已初始化的新 pipe_resource

concrete 實作可在 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:192](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L192) 驗證，registration 則在 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:470](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L470)

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_screen.h:374](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L374)，用來顯示 `pipe_screen::flush_frontbuffer` 的 evidence 邊界是呈現而非 storage 建立：callback 借用 `resource`，並接收 opaque `winsys_drawable_handle`、layer 與可選的 `subbox` 陣列，讓 screen／winsys 實作完成 display integration

```c
...
   /**
    * Do any special operations to ensure frontbuffer contents are
    * displayed, eg copy fake frontbuffer.
    * \param winsys_drawable_handle  an opaque handle that the calling context
    *                                gets out-of-band
    * \param nboxes the number of sub regions to flush
    * \param subbox an array of optional sub regions to flush
    */
   void (*flush_frontbuffer)(struct pipe_screen *screen,
                             struct pipe_context *ctx,
                             struct pipe_resource *resource,
                             unsigned level, unsigned layer,
                             void *winsys_drawable_handle,
                             unsigned nboxes,
                             struct pipe_box *subbox);
...
```

State Tracker 的 front request 會經 [Mesa: src/mesa/state_tracker/st_manager.c:814](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L814) 進入 st_manager_flush_frontbuffer，最終由 frontend 與 screen 協調顯示。 softpipe concrete callback 位於 [Mesa: src/gallium/drivers/softpipe/sp_screen.c:407](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.c#L407)，會把 displaytarget 交給 sw_winsys

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_screen.c:440](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.c#L440)，用來顯示 `softpipe_create_screen()` 配置 `softpipe_screen`、保存 borrowed `winsys`，再將 `context_create`、`flush_frontbuffer`、texture 與 fence callbacks 寫入 `screen->base`。 所有 stages 共用 `sp_compiler_options`，呼叫端最後只取得 `&screen->base`

```c
struct pipe_screen *
softpipe_create_screen(struct sw_winsys *winsys)
{
...
   struct softpipe_screen *screen = CALLOC_STRUCT(softpipe_screen);

   if (!screen)
      return NULL;

   sp_debug = debug_get_option_sp_debug();

   screen->winsys = winsys;

   screen->base.destroy = softpipe_destroy_screen;

   screen->base.get_name = softpipe_get_name;
   screen->base.get_vendor = softpipe_get_vendor;
   screen->base.get_device_vendor = softpipe_get_vendor; // TODO should be the CPU vendor
   screen->base.get_screen_fd = softpipe_screen_get_fd;
   screen->base.get_timestamp = u_default_get_timestamp;
   screen->base.query_memory_info = util_sw_query_memory_info;
   screen->base.is_format_supported = softpipe_is_format_supported;
   screen->base.context_create = softpipe_create_context;
   screen->base.flush_frontbuffer = softpipe_flush_frontbuffer;
   screen->use_llvm = sp_debug & SP_DBG_USE_LLVM;

   for (unsigned i = 0; i <= MESA_SHADER_COMPUTE; i++)
      screen->base.nir_options[i] = &sp_compiler_options;

   softpipe_init_screen_texture_funcs(&screen->base);
   softpipe_init_screen_fence_funcs(&screen->base);

   softpipe_init_shader_caps(screen);
   softpipe_init_compute_caps(screen);
   softpipe_init_screen_caps(screen);

   return &screen->base;
...
}
```

`softpipe_screen` 將 `pipe_screen` 放在 base 欄位，並另外保存由外層 pipe-loader device 管理的 `sw_winsys` 借用 pointer。 `create_screen()` 不接手 winsys ownership。 softpipe screen destroy 只釋放自身配置，winsys destroy 留給 pipe-loader device teardown

texture 與 fence callback 由分開的 init helper 填入，`context_create` 與 `flush_frontbuffer` 則直接賦值。 呼叫端永遠只看到回傳的 `&screen->base`

這個 pattern 說明 pipe_screen 是 stable frontend contract，不是 driver 實際配置的完整型態。 driver 可在 base 外保存 compiler、queue、winsys 或其他資料，但 callback 第一個參數仍是 pipe_screen *，實作再用 container cast 找回私有 screen

#### Rendering context callback table

`pipe_context` 是 Gallium 的 per-context object，集中 mutable state setter、draw、mapping 與 submission callbacks。 State Tracker 依 operation 呼叫這些欄位，driver context 則把自己的私有 struct 以 `pipe_context` base 暴露

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:100](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L100)，用來顯示 common base 中的 screen、frontend 私有資料、uploaders 與 destroy callback：

```c
/**
 * Gallium rendering context.  Basically:
 *  - state setting functions
 *  - VBO drawing functions
 *  - surface functions
 */
struct pipe_context {
   struct pipe_screen *screen;

   void *priv;  /**< context private data (for DRI for example) */
   void *draw;  /**< private, for draw module (temporary?) */
   struct u_vbuf *vbuf; /**< for cso_context, don't use in drivers */

   /**
    * Stream uploaders created by the driver. All drivers, gallium frontends, and
    * modules should use them.
    *
    * Use u_upload_alloc or u_upload_data as many times as you want.
    * Once you are done, use u_upload_unmap.
    */
   struct u_upload_mgr *stream_uploader; /* everything but shader constants */
   struct u_upload_mgr *const_uploader;  /* shader constants only */

   /**
    * Debug callback set by u_default_set_debug_callback. Frontends should use
    * set_debug_callback in case drivers need to flush compiler queues.
    */
   struct util_debug_callback debug;

   void (*destroy)(struct pipe_context *);
...
```

context 透過 screen 建立非擁有關係，但 context destroy 必須先釋放自己持有的 screen resource／state object／uploader references。 priv 由 context_create 的 priv 參數傳入，driver 不應把它當作自己配置的資料。 stream uploader 與 const uploader 則是 driver 建立、frontend 共用的 upload utility

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:131](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L131)，用來顯示 `pipe_context::draw_vbo` 的 contract 說明 direct 與 indirect multi-draw 如何共用入口：indirect 路徑固定 `num_draws == 1` 並改讀 `indirect->draw_count`，direct 路徑則由 `draws` 陣列提供可變的 start／count

```c
...
   /**
    * VBO drawing
    */
   /*@{*/
   /**
    * Multi draw.
    *
    * For indirect multi draws, num_draws is 1 and indirect->draw_count
    * is used instead.
    *
    * Caps:
    * - Always supported: Direct multi draws
    * - pipe_caps.multi_draw_indirect: Indirect multi draws
    * - pipe_caps.multi_draw_indirect_params: Indirect draw count
    *
    * Differences against glMultiDraw and glMultiMode:
    * - "info->mode" and "draws->index_bias" are always constant due to the lack
    *   of hardware support and CPU performance concerns. Only start and count
    *   vary.
    * - if "info->increment_draw_id" is false, draw_id doesn't change between
    *   draws
    *
    * Direct multi draws are also generated by u_threaded_context, which looks
    * ahead in gallium command buffers and merges single draws.
    *
    * \param pipe          context
    * \param info          draw info
    * \param drawid_offset offset to add for drawid param of each draw
    * \param indirect      indirect multi draws
    * \param draws         array of (start, count) pairs for direct draws
    * \param num_draws     number of direct draws; 1 for indirect multi draws
    */
   pipe_draw_func draw_vbo;
...
```

State Tracker 呼叫端是 [Mesa: src/mesa/state_tracker/st_draw.c:104](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_draw.c#L104)，中間的 CSO default 最終呼叫 `pipe->draw_vbo`。 softpipe registration 位於 [Mesa: src/gallium/drivers/softpipe/sp_context.c:223](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_context.c#L223)，concrete `softpipe_draw_vbo` 接著消費同一份 `pipe_draw_info`

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:486 到 549](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L486)，用來顯示 framebuffer／viewport setters 接收完整 state，`set_sampler_views()` 則以 slot range 與 unbind count 清除尾端 views

```c
...
   void (*set_inlinable_constants)(struct pipe_context *,
                                   mesa_shader_stage shader,
                                   uint num_values, uint32_t *values);

   void (*set_framebuffer_state)(struct pipe_context *,
                                 const struct pipe_framebuffer_state *);
...
   void (*set_viewport_states)(struct pipe_context *,
                               unsigned start_slot,
                               unsigned num_viewports,
                               const struct pipe_viewport_state *);

   void (*set_sampler_views)(struct pipe_context *,
                             mesa_shader_stage shader,
                             unsigned start_slot, unsigned num_views,
                             unsigned unbind_num_trailing_slots,
                             struct pipe_sampler_view **views);
...
```

`set_framebuffer_state` 的 State Tracker 呼叫端是 [Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:782](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/cso_cache/cso_context.c#L782)，softpipe concrete 實作在 [Mesa: src/gallium/drivers/softpipe/sp_state_surface.c:48](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_surface.c#L48)

完整 framebuffer state 由前者借給 callback，後者保存所需 surface references

sampler view 呼叫端是 [Mesa: src/mesa/state_tracker/st_atom_texture.c:357](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_texture.c#L357)，softpipe 以 [Mesa: src/gallium/drivers/softpipe/sp_state_sampler.c:350](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_sampler.c#L350) 註冊 setter

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:789](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L789)，用來顯示 `pipe_context::flush` 的 fence contract 要求實作以 `screen->fence_reference()` 替換 `**fence`，先解除呼叫端舊 reference 再交付新 fence。 `PIPE_FLUSH_DEFERRED` 與 `PIPE_FLUSH_ASYNC` 也會改變有限完成與跨 context ordering 保證

```c
...
   /**
    * Flush draw commands.
    *
    * This guarantees that the new fence (if any) will finish in finite time,
    * unless PIPE_FLUSH_DEFERRED is used.
    *
    * Subsequent operations on other contexts of the same screen are guaranteed
    * to execute after the flushed commands, unless PIPE_FLUSH_ASYNC is used.
    *
    * NOTE: use screen->fence_reference() (or equivalent) to transfer
    * new fence ref to **fence, to ensure that previous fence is unref'd
    *
    * \param fence  if not NULL, an old fence to unref and transfer a
    *    new fence reference to
    * \param flags  bitfield of enum pipe_flush_flags values.
    */
   void (*flush)(struct pipe_context *pipe,
                 struct pipe_fence_handle **fence,
                 unsigned flags);
...
```

State Tracker 呼叫端是 [Mesa: src/mesa/state_tracker/st_cb_flush.c:63](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L63)。 fence output 的 ownership 規則寫在 contract 內，driver 必須用 screen fence reference helper 替換呼叫端的舊 reference。 softpipe 以 [Mesa: src/gallium/drivers/softpipe/sp_context.c:228](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_context.c#L228) 註冊 softpipe_flush_wrapped

`softpipe_create_context()` 提供這張抽象 callback table 的具體例子。 它先連接 borrowed `screen`／`priv` 與 `softpipe_destroy`，再把 state setters、`softpipe_draw_vbo` 與 `softpipe_flush_wrapped` 填入 embedded `pipe_context`。 完整 registration 片段與 context 清理會在後文「Gallium driver 的實作形狀／Softpipe／Context callback registration」單元展開

### Resource、surface 與 view

driver 已建立 `pipe_resource` storage，State Tracker 接著要把同一份 storage 作為 framebuffer attachment 或 shader input。 `pipe_surface` 與 `pipe_sampler_view` 的 resource references、subresource 欄位與 destroy callbacks，會顯示更換 view、unbind slot 或刪除 resource 時由哪個 reference 維持 backing 存活

```text
pipe_resource：reference-counted storage identity
  ├─ pipe_surface：render-target subresource view
  │    └─ pipe_framebuffer_state
  │         └─ pipe_context::set_framebuffer_state()
  └─ pipe_sampler_view：shader-visible subresource view
       └─ pipe_context::set_sampler_views()
```

#### Storage identity

`pipe_resource` 讓 frontend、utility 與 driver 以同一個 reference-counted object 指稱 buffer 或 texture storage。 framebuffer slot 與 sampler slot 由各自的 view／binding state 保存，一次 CPU map 則由 `pipe_transfer` 描述。 State Tracker 建立 template 後呼叫 `pipe_screen::resource_create`，driver 回傳的 concrete resource 會包含可由 contract 存取的 `pipe_resource` base

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_state.h:554](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_state.h#L554)，用來顯示 `struct pipe_resource` 將 refcount 放在共用 base，並以 `target`、`format`、level-0 尺寸、`array_size`、`last_level` 與 sample counts 定義 storage identity。 `usage` 與 `bind` 則限制預期存取方式

```c
/**
 * A memory object/resource such as a vertex buffer or texture.
 */
struct pipe_resource
{
   /* Put the refcount on its own cache line to prevent "False sharing". */
   EXCLUSIVE_CACHELINE(struct pipe_reference reference);

   uint32_t width0; /**< Used by both buffers and textures. */
   uint32_t height0;    /* textures >= 64K are possible */
   uint16_t depth0;
   uint16_t array_size;

   enum pipe_format format:16;         /**< PIPE_FORMAT_x */
   enum pipe_texture_target target:8; /**< PIPE_TEXTURE_x */
   uint8_t last_level;    /**< Index of last mipmap level present/defined */

   /** Number of samples determining quality, driving rasterizer, shading,
    *  and framebuffer.
    */
   uint8_t nr_samples;

   /** Multiple samples within a pixel can have the same value.
    *  nr_storage_samples determines how many slots for different values
    *  there are per pixel. Only color buffers can set this lower than
    *  nr_samples.
    */
   uint8_t nr_storage_samples;

   uint8_t nr_sparse_levels; /**< Mipmap levels support partial resident */

   unsigned compression_rate:4; /**< Fixed-rate compresion bitrate if any */

   enum pipe_resource_usage usage:4;
   uint32_t bind;            /**< bitmask of PIPE_BIND_x */
...
```

reference 位於 base，所有 ownership helper 都能在不知道 driver subclass 的情況下增減 reference。 width0、height0、depth0 與 array_size 描述 level 0 幾何形狀，last_level 描述 mipmap 上界。 format 與 target 是 storage 的基礎 identity，view 可以在相容規則內選擇自己的 format 或範圍

nr_samples 表達 rasterization quality，nr_storage_samples 表達實際不同 sample value 的槽數。 usage 是配置傾向，bind 是 resource 必須支援的用途集合。 driver 依這些欄位選擇 layout，建立完成後，會影響 storage identity 的 template 欄位便成為這份 resource 的固定條件

State Tracker 呼叫端是 [Mesa: src/mesa/state_tracker/st_texture.c:87](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L87) 到 [Mesa: src/mesa/state_tracker/st_texture.c:106](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L106)。 它填好同一組欄位，再將回傳 resource 放入 gl_texture_object::pt。 frontend 持有的是 resource reference，不是 driver 私有配置的裸 pointer

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:154](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L154)，用來顯示 `softpipe_resource_create_front()` 如何配置私有 `softpipe_resource`，並初始化內嵌的公開 base：

```c
static struct pipe_resource *
softpipe_resource_create_front(struct pipe_screen *screen,
                               const struct pipe_resource *templat,
                               const void *map_front_private)
{
   struct softpipe_resource *spr = CALLOC_STRUCT(softpipe_resource);
   if (!spr)
      return NULL;

   assert(templat->format != PIPE_FORMAT_NONE);

   spr->base = *templat;
   pipe_reference_init(&spr->base.reference, 1);
   spr->base.screen = screen;
...
}
```

softpipe_resource 包含 base，再保存軟體 layout、data 或 displaytarget。 實作先複製 template，接著把 reference 初始化為一，並寫入所屬 screen。 回傳值稍後是 &spr->base，State Tracker 無法直接存取 spr 的私有欄位

concrete resource destroy 位於 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:198](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L198)。 最後一個 reference 消失時，screen callback 依 backing 類型釋放 displaytarget 或 CPU storage。 ownership 因而從 reference helper 一路收斂到 resource_destroy，不由 State Tracker 直接 free

#### Render-target view

同一份 resource 可能只以特定 format、mipmap level 與 layer range 作為 render target，因此 view 必須擁有獨立 reference，又不能複製 storage。 以下程式碼來自 [Mesa: src/gallium/include/pipe/p_state.h:407](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_state.h#L407)，用來確認 `struct pipe_surface` 如何描述被檢視的 storage、render interpretation、範圍與 sample count

```c
/**
 * A view into a texture that can be bound to a color render target /
 * depth stencil attachment point.
 */
struct pipe_surface
{
   struct pipe_reference reference;
   enum pipe_format format:16;
   /**
    * Number of samples for the surface.  This will be 0 if rendering
    * should use the resource's nr_samples, or another value if the resource
    * is bound using FramebufferTexture2DMultisampleEXT.
    */
   unsigned nr_samples:16;

   unsigned first_layer:16;
   unsigned last_layer:16;
   unsigned level;

   struct pipe_resource *texture; /**< resource into which this is a view  */
};
```

texture 指向 storage，surface reference 管理 view 自己的生命週期。 format 可以是與 resource 相容的 render interpretation，level 與 layer range 則限定 attachment 範圍。 nr_samples 為零時沿用 resource sample count，非零時覆寫本次 surface 的 rendering sample count

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_state.h:429](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_state.h#L429)，用來顯示 `struct pipe_framebuffer_state` 以 by-value `cbufs`／`zsbuf` 保存 attachment views，`nr_cbufs` 與 `viewmask` 描述有效集合，no-attachment 情況則由 `width`／`height`／`layers` 與 `samples` 提供幾何資料，`resolve` 另保留 resource reference

```c
/**
 * Note that pipe_surfaces are "texture views for rendering"
 * and so in the case of ARB_framebuffer_no_attachment there
 * is no pipe_surface state available such that we may
 * extract the number of samples and layers.
 */
struct pipe_framebuffer_state
{
   uint32_t width, height;
   uint16_t layers;  /**< Number of layers  in a no-attachment framebuffer */
   uint8_t samples; /**< Number of samples in a no-attachment framebuffer */

   /** multiple color buffers for multiple render targets */
   uint8_t nr_cbufs;
   /** true if pixel local storage is enabled */
   bool pls_enabled;
   /** used for multiview */
   uint8_t viewmask;
   struct pipe_surface cbufs[PIPE_MAX_COLOR_BUFS];

   struct pipe_surface zsbuf;      /**< Z/stencil buffer */

   struct pipe_resource *resolve;
};
```

State Tracker 呼叫端在 [Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:164](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_framebuffer.c#L164) 將 `gl_renderbuffer::surface` 複製到 `cbufs`，並在 [Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:196](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_framebuffer.c#L196) 填入 `zsbuf`。 CSO 複製 helper 取得必要 reference，呼叫端的 stack framebuffer 回傳後即可消失

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_state_surface.c:47](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_surface.c#L47)，用來顯示 `softpipe_set_framebuffer_state()` 在替換 views 前先 `draw_flush()`，逐 slot 以 `pipe_surface_equal()` 找出真正改變的 cbuf／zsbuf，flush 對應舊 tile cache 後才呼叫 `sp_tile_cache_set_surface()` 更新 references

```c
void
softpipe_set_framebuffer_state(struct pipe_context *pipe,
                               const struct pipe_framebuffer_state *fb)
{
   struct softpipe_context *sp = softpipe_context(pipe);
   uint i;

   draw_flush(sp->draw);

   for (i = 0; i < PIPE_MAX_COLOR_BUFS; i++) {
      /* check if changing cbuf */
      if (!pipe_surface_equal(&sp->framebuffer.cbufs[i], &fb->cbufs[i])) {
         /* flush old */
         sp_flush_tile_cache(sp->cbuf_cache[i]);

         /* update cache */
         sp_tile_cache_set_surface(sp->cbuf_cache[i], &fb->cbufs[i]);
      }
   }

   /* zbuf changing? */
   if (!pipe_surface_equal(&sp->framebuffer.zsbuf, &fb->zsbuf)) {
      /* flush old */
      sp_flush_tile_cache(sp->zsbuf_cache);

      /* update cache */
      sp_tile_cache_set_surface(sp->zsbuf_cache, &fb->zsbuf);
...
   }
   ...
}
```

實作在替換 view 前先 flush 依賴舊 surface 的 draw 與 tile cache，維持 command order。 每個 cbuf 與 zsbuf 分別比較，只有改變的 surface 才更新對應 cache。 函式尾端以 util_copy_framebuffer_state 保存新 state 並更新 resource references

這個 concrete 路徑證明 surface 不是 storage 副本。 tile cache 只改指向新 view，`pipe_surface` 中的 texture reference 仍是實際 backing。 下一次 framebuffer setter 到來前，softpipe context 持有自己的 framebuffer state 副本

#### Shader-visible view

Shader 需要透過 view 取得 resource 的特定 format、target、swizzle、level 與 layer 範圍，同時讓 storage 在 binding 期間保持存活。 以下程式碼來自 [Mesa: src/gallium/include/pipe/p_state.h:488](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_state.h#L488)，用來確認 `struct pipe_sampler_view` 保存哪些 interpretation、ownership 與 context metadata

```c
/**
 * A view into a texture that can be bound to a shader stage.
 */
struct pipe_sampler_view
{
   /* this refcount is non-atomic */
   struct pipe_reference reference;

   enum pipe_format format:12;      /**< typed PIPE_FORMAT_x */
   unsigned astc_decode_format:2;   /**< intermediate format used for ASTC textures */
   bool is_tex2d_from_buf:1;       /**< true if union is tex2d_from_buf */
   enum pipe_texture_target target:5; /**< PIPE_TEXTURE_x */
   unsigned swizzle_r:3;         /**< PIPE_SWIZZLE_x for red component */
   unsigned swizzle_g:3;         /**< PIPE_SWIZZLE_x for green component */
   unsigned swizzle_b:3;         /**< PIPE_SWIZZLE_x for blue component */
   unsigned swizzle_a:3;         /**< PIPE_SWIZZLE_x for alpha component */
   struct pipe_resource *texture; /**< texture into which this is a view  */
   struct pipe_context *context; /**< context this view belongs to */
   union {
      struct {
         unsigned first_layer:16;  /**< first layer to use for array textures */
         unsigned last_layer:16;   /**< last layer to use for array textures */
         unsigned first_level:8;   /**< first mipmap level to use */
         unsigned last_level:8;    /**< last mipmap level to use */
...
```

view reference 是 non-atomic，因為 contract 預期 binding 與生命週期由 context ordering 管理。 texture 另有 resource reference，context 記錄建立此 view 的 pipe_context。 format 與 swizzle 控制 shader 看到的 component interpretation，並未改變 resource 本身

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:838](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L838)，用來顯示這三個 sampler-view callbacks 區分不同生命週期動作：`create_sampler_view()` 產生新 view，`sampler_view_destroy()` 銷毀既有 owner reference，而 `sampler_view_release()` 回傳後則由 driver 完整接手該 view

```c
...
   /**
    * Create a view on a texture to be used by a shader stage.
    */
   struct pipe_sampler_view * (*create_sampler_view)(struct pipe_context *ctx,
                                                     struct pipe_resource *texture,
                                                     const struct pipe_sampler_view *templat);

   /**
    * Destroy a view on a texture.
    *
    * \param ctx the current context
    * \param view the view to be destroyed
    *
    * \note The current context may not be the context in which the view was
    *       created (view->context). However, the caller must guarantee that
    *       the context which created the view is still alive.
    */
   void (*sampler_view_destroy)(struct pipe_context *ctx,
                                struct pipe_sampler_view *view);

   /**
    * Signal the driver that the frontend has released a view on a texture.
    *
    * \param ctx the current context
    * \param view the view to be released
    *
    * \note The current context may not be the context in which the view was
    *       created (view->context). Following this call, the driver has full
    *       ownership of the view.
    */
   void (*sampler_view_release)(struct pipe_context *ctx,
                                struct pipe_sampler_view *view);
...
```

State Tracker create 呼叫端是 [Mesa: src/mesa/state_tracker/st_sampler_view.c:538](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_sampler_view.c#L538)，binding 呼叫端是 [Mesa: src/mesa/state_tracker/st_atom_texture.c:357](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_texture.c#L357)。 texture object 的 per-context container 持有一般 view，額外暫時 view 則在 binding 後透過釋放 callback 交還 ownership

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_tex_sample.c:3583](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_tex_sample.c#L3583)，用來顯示 `softpipe_create_sampler_view()` 配置 `sp_sampler_view`、複製 template 並令 view reference 成為 1，接著以 `pipe_resource_reference()` 取得 `resource` ownership，再將建立者 `pipe` 存入 `view->context`

```c
struct pipe_sampler_view *
softpipe_create_sampler_view(struct pipe_context *pipe,
                             struct pipe_resource *resource,
                             const struct pipe_sampler_view *templ)
{
   struct sp_sampler_view *sview = CALLOC_STRUCT(sp_sampler_view);
   const struct softpipe_resource *spr = (struct softpipe_resource *)resource;

   if (sview) {
      struct pipe_sampler_view *view = &sview->base;
      *view = *templ;
      view->reference.count = 1;
      view->texture = NULL;
      pipe_resource_reference(&view->texture, resource);
      view->context = pipe;
...
   }
   ...
   return (struct pipe_sampler_view *)sview;
}
```

實作複製 template 後初始化 view reference，利用 pipe_resource_reference 取得 texture ownership，並保存建立它的 context。 回傳 base 後，State Tracker 只依 pipe_sampler_view contract 操作。 softpipe destroy 在 [Mesa: src/gallium/drivers/softpipe/sp_state_sampler.c:90](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_sampler.c#L90) 先解除 texture reference，再 free view

softpipe 的 create／set／destroy／釋放 registration 集中在 [Mesa: src/gallium/drivers/softpipe/sp_state_sampler.c:342](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_sampler.c#L342)。 contract 因而完整涵蓋 view 從建立、binding reference 到最終釋放的生命週期

### Transfer 與 mapping

frontend 準備以 CPU 讀寫一段 buffer／texture subresource，手上有 resource reference、usage flags、level 與 box。 map callback 必須同時回傳 pointer 和描述實際 layout／生命週期的 `pipe_transfer`，後續 `transfer_flush_region` 與 unmap 才能處理 staging、stride 與 hazard。 本節沿 map output slot 追到最後一次 unmap

```callgraph
Mesa State Tracker texture mapping
=================================================
[Mesa: src/mesa/state_tracker/st_texture.c:289] st_texture_image_map()
  │
  │  box = { x, y, z, width, height, depth };
  ├─ if map request cannot be represented by current resource
  │    └─ resource／level preparation 失敗：return NULL
  └─ pipe_texture_map_3d(st->pipe, tex, level, usage, &box,
                         transfer, out_stride, out_layer_stride)
       // handoff：pipe_resource + usage + level + pipe_box
       ↓
[Mesa: src/gallium/auxiliary/util/u_inlines.h:675] pipe_texture_map_3d()
  │
  ├─ transfer slot 先設為 NULL
  └─ map = pipe->texture_map(pipe, resource, level, usage, box, transfer)
       ↓

Gallium driver map callback
=================================================
[Mesa: src/gallium/include/pipe/p_context.h:899] pipe_context::texture_map
  │
  ├─ 失敗：return NULL，transfer 保持 NULL
  └─ 成功
       ├─ transfer->resource 保存 resource reference
       ├─ transfer->usage／level／box 保存 mapping contract
       ├─ transfer->stride／layer_stride 描述 CPU layout
       └─ return mapped pointer
            // terminal object：mapped pointer + pipe_transfer metadata
            ↓
[Mesa: src/gallium/include/pipe/p_context.h:906] pipe_context::texture_unmap
  │
  ├─ explicit-flush usage 可先呼叫 transfer_flush_region
  └─ texture_unmap(pipe, transfer)
       // 最終結果：driver 結束 mapping，transfer 生命週期到此終止
```

map 成功時呼叫端同時取得 pointer 與 owned `pipe_transfer`，後者保存 resource、box、usage 與 driver layout。 explicit flush 只標記寫回範圍，unmap 才結束 mapping 並終止 transfer 生命週期

#### Map request 的 box、stride 與 usage

Mapped pointer 只能讓 CPU 存取資料，後續 callback 還需要一個 object 保存這次 mapping 的 identity、layout 與生命週期。 以下程式碼來自 [Mesa: src/gallium/include/pipe/p_state.h:608](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_state.h#L608)，用來確認 `struct pipe_transfer` 如何描述 resource、usage、level、requested box 與 driver 回報的 layout

```c
/**
 * Transfer object.  For data transfer to/from a resource.
 */
struct pipe_transfer
{
   struct pipe_resource *resource; /**< resource to transfer to/from  */
   enum pipe_map_flags usage:24;
   unsigned level:8;               /**< texture mipmap level */
   struct pipe_box box;            /**< region of the resource to access */
   unsigned stride;                /**< row stride in bytes */
   uintptr_t layer_stride;          /**< image/layer stride in bytes */

   /* Offset into a driver-internal staging buffer to make use of unused
    * padding in this structure.
    */
   unsigned offset;
};
```

resource 是 transfer 持有的 reference。 usage 保存 PIPE_MAP_* flags，讓 unmap 實作知道是否發生 write、是否要求 explicit flush 或是否使用 unsynchronized 路徑。 level 與 box 固定 request identity，stride 與 layer_stride 則描述 driver 實際回傳的線性 layout

stride 不能由 box.width 直接推導。 texture format 可能以 block 壓縮，row 也可能帶 padding。 layer_stride 同理不能只用 height 乘 stride 猜測。 State Tracker 在讀寫 mapped image 時必須使用 transfer 回報值，否則下一 row 或 layer 的位址可能錯誤

State Tracker texture 呼叫端在 [Mesa: src/mesa/state_tracker/st_texture.c:318](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L318) 取得 pointer 與 pipe_transfer，成功後由 st_texture_image_insert_transfer 保存。 buffer 呼叫端在 [Mesa: src/mesa/main/bufferobj.c:509](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L509) 將 transfer 存入 gl_buffer_object::transfer[index]

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:355](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L355)，用來顯示 `softpipe_transfer_map()` 配置私有 transfer 後，以 `pipe_resource_reference()` 接住 storage、by-value 複製 `box`，再從 `softpipe_resource` 的 per-level layout 填入 `stride` 與 `layer_stride`

```c
static void *
softpipe_transfer_map(struct pipe_context *pipe,
                      struct pipe_resource *resource,
                      unsigned level, unsigned usage,
                      const struct pipe_box *box,
                      struct pipe_transfer **transfer)
{
...
   spt = CALLOC_STRUCT(softpipe_transfer);
   if (!spt)
      return NULL;

   pt = &spt->base;

   pipe_resource_reference(&pt->resource, resource);
   pt->level = level;
   pt->usage = usage;
   pt->box = *box;
   pt->stride = spr->stride[level];
   pt->layer_stride = spr->img_stride[level];
...
}
```

實作先配置私有 transfer，再以 `pipe_resource_reference` 取得 storage ownership。 box 的 by-value 副本保證呼叫端原本的 stack box 消失後 request 仍完整。 stride 直接取 softpipe resource 的 per-level layout，`layer_stride` 取 image stride

softpipe_transfer 還能在 base 外保存私有 offset。 呼叫端只看 base metadata，driver map 函式用 offset 調整回傳 pointer。 這是 Gallium base struct pattern 的另一個例子，contract 保留跨 driver 共通欄位，實作自行擴充

#### Buffer／texture map callback

Buffer 與 texture 可以採用不同 mapping 路徑，但兩者都必須同時交付 CPU pointer 與後續 flush／unmap 所需的 transfer。 以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:871](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L871)，用來確認 `pipe_context::buffer_map` 的 request 參數、pointer 回傳與 `out_transfer` ownership

```c
...
   /**
    * Map a resource.
    *
    * Transfers are (by default) context-private and allow uploads to be
    * interleaved with rendering.
    *
    * out_transfer will contain the transfer object that must be passed
    * to all the other transfer functions. It also contains useful
    * information (like texture strides for texture_map).
    */
   void *(*buffer_map)(struct pipe_context *,
                       struct pipe_resource *resource,
                       unsigned level,
                       unsigned usage,  /* a combination of PIPE_MAP_x */
                       const struct pipe_box *,
                       struct pipe_transfer **out_transfer);
...
```

註解明確說 transfer 預設為 context 私有，out_transfer 必須傳給其他 transfer callback。 buffer_map 回傳 pointer，並以 output 參數轉移新 transfer ownership。 呼叫端若只保存 pointer 而遺失 transfer，便無法合法 flush 或 unmap

以下程式碼來自 [Mesa: src/gallium/include/pipe/p_context.h:888](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L888)，用來顯示 map 之後可使用的 flush-region 與 unmap callback slots：

```c
...
   /* If transfer was created with WRITE|FLUSH_EXPLICIT, only the
    * regions specified with this call are guaranteed to be written to
    * the resource.
    */
   void (*transfer_flush_region)(struct pipe_context *,
                                 struct pipe_transfer *transfer,
                                 const struct pipe_box *);

   void (*buffer_unmap)(struct pipe_context *,
                        struct pipe_transfer *transfer);

   void *(*texture_map)(struct pipe_context *,
                        struct pipe_resource *resource,
                        unsigned level,
                        unsigned usage,  /* a combination of PIPE_MAP_x */
                        const struct pipe_box *,
                        struct pipe_transfer **out_transfer);

   void (*texture_unmap)(struct pipe_context *,
                         struct pipe_transfer *transfer);
...
```

PIPE_MAP_FLUSH_EXPLICIT 改變 mapped writes 的保證寫入範圍。 呼叫端的保證範圍是以 `transfer_flush_region` 指定的 resource 區域，未列出的 mapped bytes 可被忽略。 呼叫端對 transfer 的持有責任仍延續到 unmap。 buffer_unmap 與 texture_unmap 結束 active mapping，之後 transfer 不再有效

texture 呼叫端由 [Mesa: src/gallium/auxiliary/util/u_inlines.h:675](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/util/u_inlines.h#L675) 將座標組成 pipe_box，再呼叫 texture_map。 buffer 呼叫端由 [Mesa: src/mesa/main/bufferobj.c:509](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L509) 經 pipe_buffer_map_range 進入 buffer_map

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:453](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L453)，用來顯示 `softpipe_init_texture_funcs()` 將 buffer／texture 的 map 都註冊為 `softpipe_transfer_map`，兩種 unmap 也共用 `softpipe_transfer_unmap`。 `transfer_flush_region` 則使用直接 storage mapping 適用的 `u_default_transfer_flush_region`

```c
void
softpipe_init_texture_funcs(struct pipe_context *pipe)
{
   pipe->buffer_map = softpipe_transfer_map;
   pipe->buffer_unmap = softpipe_transfer_unmap;
   pipe->texture_map = softpipe_transfer_map;
   pipe->texture_unmap = softpipe_transfer_unmap;

   pipe->transfer_flush_region = u_default_transfer_flush_region;
   pipe->buffer_subdata = u_default_buffer_subdata;
   pipe->texture_subdata = u_default_texture_subdata;

   pipe->clear_texture = util_clear_texture_sw;
}
```

softpipe 的 buffer 與 texture map 共用 `softpipe_transfer_map()`，兩種 unmap 也共用 `softpipe_transfer_unmap()`。 共用實作仍能從 resource target、level 與 box 判斷 layout。 `transfer_flush_region` 使用 utility 的 no-op 實作，因為 softpipe map 直接暴露可寫 storage，不需要額外 staging copy

llvmpipe 也在 [Mesa: src/gallium/drivers/llvmpipe/lp_texture.c:1930](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_texture.c#L1930) 填入相同五個 callback slot，但實作為 llvmpipe_transfer_map 與 llvmpipe_transfer_unmap。 這個 anchor 證明 callback shape 固定，driver 可選不同 synchronization 與 layout strategy

#### Map、flush region、unmap 與 resource hazard

CPU mapping 可能和先前對同一 resource 的 rendering 發生 hazard，map flags 則決定 driver 應等待、立即失敗，還是把同步責任交給呼叫端。 以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:334](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L334)，用來追蹤 `softpipe_transfer_map()` 如何由 `PIPE_MAP_*` flags 選擇 hazard handling 路徑

```c
static void *
softpipe_transfer_map(struct pipe_context *pipe,
                      struct pipe_resource *resource,
                      unsigned level, unsigned usage,
                      const struct pipe_box *box,
                      struct pipe_transfer **transfer)
{
...
   /*
    * Transfers, like other pipe operations, must happen in order, so flush the
    * context if necessary.
    */
   if (!(usage & PIPE_MAP_UNSYNCHRONIZED)) {
      bool read_only = !(usage & PIPE_MAP_WRITE);
      bool do_not_block = !!(usage & PIPE_MAP_DONTBLOCK);
      if (!softpipe_flush_resource(pipe, resource,
                                   level, box->depth > 1 ? -1 : box->z,
                                   0, /* flush_flags */
                                   read_only,
                                   true, /* cpu_access */
                                   do_not_block)) {
         /*
          * It would have blocked, but state tracker requested no to.
          */
         assert(do_not_block);
         return NULL;
      }
   }
...
}
```

沒有 `PIPE_MAP_UNSYNCHRONIZED` 時，`softpipe_flush_resource()` 檢查指定 resource、level 與 layer 的未完成使用。 `read_only` 影響衝突判斷，`cpu_access` 表示接下來由 CPU 存取。 `PIPE_MAP_DONTBLOCK` 分支要求實作不等待，若 hazard 只能靠阻塞解決就回傳 `NULL`

State Tracker 會依 OpenGL access flags 建立 PIPE_MAP flags。 buffer 路徑的轉換位於 [Mesa: src/mesa/main/bufferobj.c:492](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L492)，texture 路徑則在呼叫 st_texture_image_map 前決定 usage。 Gallium driver 不再解讀 OpenGL bitfield

explicit flush 的 State Tracker 呼叫端位於 [Mesa: src/mesa/main/bufferobj.c:527](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L527)。 它確認 subrange 位於原 map range，再以 obj->transfer[index] 呼叫 pipe_buffer_flush_mapped_range

softpipe registration 指向 [Mesa: src/gallium/auxiliary/util/u_transfer.c:119](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/util/u_transfer.c#L119) 的 no-op，其他 driver 可以在 callback 中把指定 box 從 staging copy 回 storage

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:394](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L394)，用來顯示 `softpipe_transfer_unmap()` 對 displaytarget 呼叫相同 winsys 的 `displaytarget_unmap()`，write mapping 會遞增 `spr->timestamp` 使 caches 失效，收尾再解除 `transfer->resource` reference 並 `FREE(transfer)`

```c
/**
 * Unmap memory mapping for given pipe_transfer object.
 */
static void
softpipe_transfer_unmap(struct pipe_context *pipe,
                        struct pipe_transfer *transfer)
{
   struct softpipe_resource *spr;

   assert(transfer->resource);
   spr = softpipe_resource(transfer->resource);

   if (spr->dt) {
      /* display target */
      struct sw_winsys *winsys = softpipe_screen(pipe->screen)->winsys;
      winsys->displaytarget_unmap(winsys, spr->dt);
   }

   if (transfer->usage & PIPE_MAP_WRITE) {
      /* Mark the texture as dirty to expire the tile caches. */
      spr->timestamp++;
   }

   pipe_resource_reference(&transfer->resource, NULL);
   FREE(transfer);
}
```

displaytarget mapping 由 sw_winsys 建立，unmap 必須回到同一 winsys。 write map 增加 resource timestamp，讓 texture 與 tile cache 偵測內容已改變。 最後解除 transfer 所持 resource reference，再 free 私有 transfer。 呼叫端在此之後不得再存取 pointer 或 transfer

這條生命週期可用四個 state 辨認。 map 前只有 resource，map 成功後呼叫端同時持有 pointer 與 transfer。 explicit flush 只標記保證寫回的 subrange，仍不結束 mapping。 unmap 才結束 CPU access、處理 write visibility 並釋放 transfer ownership

### CSO、utility 與 frontend／winsys 邊界

State Tracker 已能直接呼叫 driver callbacks，但 drawable 驗證、immutable state cache 與 platform display target 仍需要跨元件協作。 要判斷 callback 方向與 ownership，必須分開讀 CSO 對 state object 的 cache／bind、DRI frontend 對 attachment resources 的 roundtrip，以及 winsys 對 display target 和 loader callbacks 的持有關係

這些邊界的主要路徑如下

```text
immutable state caching
  └─ OpenGL blend state
       └─ st_update_blend()
            └─ cso_set_blend()
                 ├─ cache lookup
                 ├─ pipe_context::create_blend_state()
                 └─ pipe_context::bind_blend_state()

frontend drawable roundtrip
  └─ 視窗系統 drawable
       └─ dri_st_framebuffer_validate()
            └─ attachment pipe_resource references
                 └─ State Tracker winsys framebuffer

winsys display handoff
  └─ pipe_screen::flush_frontbuffer()
       └─ 軟體 winsys displaytarget_display()
            └─ loader-provided display operation
```

#### CSO cache 保存 immutable state object

State Tracker 可能反覆產生內容相同的 state descriptor，因此 CSO cache 必須用 immutable value 找到可重用的 driver handle，並避免無條件重新 bind。 以下程式碼來自 [Mesa: src/mesa/state_tracker/st_atom_blend.c:339](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_blend.c#L339)，用來確認 `st_update_blend()` 如何建立暫時的 blend template，再把它交給 `cso_set_blend()`

```c
void
st_update_blend(struct st_context *st)
{
...
   if (_mesa_is_multisample_enabled(ctx) &&
       !(ctx->DrawBuffer->_IntegerDrawBuffers & 0x1)) {
      /* Unlike in gallium/d3d10 these operations are only performed
       * if both msaa is enabled and we have a multisample buffer.
       */
      blend->alpha_to_coverage = ctx->Multisample.SampleAlphaToCoverage;
      blend->alpha_to_one = ctx->Multisample.SampleAlphaToOne;
      blend->alpha_to_coverage_dither =
         ctx->Multisample.SampleAlphaToCoverageDitherControl !=
         GL_ALPHA_TO_COVERAGE_DITHER_DISABLE_NV;
   }

   cso_set_blend(st->cso_context, blend);
}
```

`st_update_blend()` 先將 OpenGL context state 降成 `pipe_blend_state` template，再將 borrowed template pointer 交給 `cso_set_blend()`。 template 的生命週期涵蓋這次呼叫。 CSO 在呼叫期間完成查找或複製，State Tracker 的 stack object 隨後即可離開 scope

以下程式碼來自 [Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:519](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/cso_cache/cso_context.c#L519)，用來顯示 `cso_set_blend()` 依 independent-blend state 選擇 hash key size，cache miss 才配置 `cso_blend`、複製 canonical template bytes 並呼叫 `create_blend_state()`。 只有找到的 driver handle 不同於 `ctx->blend` 時才重新 bind

```c
enum pipe_error
cso_set_blend(struct cso_context *cso,
              const struct pipe_blend_state *templ)
{
...
   if (templ->independent_blend_enable) {
      ...
      hash_key = cso_construct_key(templ, CSO_BLEND_KEY_SIZE_ALL_RT);
      iter = cso_find_state_template(&ctx->cache, hash_key, CSO_BLEND,
                                     templ, CSO_BLEND_KEY_SIZE_ALL_RT);
      key_size = CSO_BLEND_KEY_SIZE_ALL_RT;
   } else {
      hash_key = cso_construct_key(templ, CSO_BLEND_KEY_SIZE_RT0);
      iter = cso_find_state_template(&ctx->cache, hash_key, CSO_BLEND,
                                     templ, CSO_BLEND_KEY_SIZE_RT0);
      key_size = CSO_BLEND_KEY_SIZE_RT0;
   }

   if (cso_hash_iter_is_null(iter)) {
      struct cso_blend *cso = MALLOC(sizeof(struct cso_blend));
      if (!cso)
         return PIPE_ERROR_OUT_OF_MEMORY;

      memset(&cso->state, 0, sizeof cso->state);
      memcpy(&cso->state, templ, key_size);
      cso->data = ctx->base.pipe->create_blend_state(ctx->base.pipe, &cso->state);

      iter = cso_insert_state(&ctx->cache, hash_key, CSO_BLEND, cso);
      if (cso_hash_iter_is_null(iter)) {
         FREE(cso);
         return PIPE_ERROR_OUT_OF_MEMORY;
      }

      handle = cso->data;
   } else {
      handle = ((struct cso_blend *)cso_hash_iter_data(iter))->data;
   }

   if (ctx->blend != handle) {
      ctx->blend = handle;
      ctx->base.pipe->bind_blend_state(ctx->base.pipe, handle);
   }
...
}
```

`key_size` 決定 blend identity。 啟用 independent blend 時會涵蓋全部 render-target entries，未啟用時只比較第一個 entry。 hash 用來縮小搜尋範圍，find 還會比較 template bytes。 cache miss 才配置 container、複製 canonical bytes，再呼叫 `create_blend_state()`

driver handle 的 owner 是 CSO cache entry。 清除 entry 時會經 [Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:163](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/cso_cache/cso_context.c#L163) 進入 delete callback，bind callback 只借用 handle

cache hit 則重用 handle，只有它不同於 ctx->blend 時才 bind。 immutable 是 CSO 的使用規約，不是 C type 強制的限制

softpipe 的 concrete create 與 bind 實作位於 [Mesa: src/gallium/drivers/softpipe/sp_state_blend.c:38](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_blend.c#L38)，callback registration 位於 [Mesa: src/gallium/drivers/softpipe/sp_state_blend.c:137](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_state_blend.c#L137)

create 以 `mem_dup` 建立 driver-owned 副本。 bind 把 handle 存入 softpipe context 並標記 `SP_NEW_BLEND`，delete 才釋放該副本。 這正好對應 CSO entry 建立、借用 bind 與最後刪除的 ownership contract

#### Frontend 把視窗系統 drawable 轉成 Gallium resource

視窗系統 drawable 是 loader-facing object，不是 pipe_resource。 State Tracker 需要的是能建立 pipe_surface 的 color、depth 或 stencil resource。 Gallium DRI frontend 因此以 pipe_frontend_drawable callback table 隔開兩種 object model，讓 drawable 驗證與 attachment 配置留在 frontend，State Tracker 只接收 resource reference

drawable 由 [Mesa: src/gallium/frontends/dri/dri_drawable.c:150](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_drawable.c#L150) 配置，並在 [Mesa: src/gallium/frontends/dri/dri_drawable.c:172](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_drawable.c#L172) 註冊 validate、flush_front 與 flush_swapbuffers

drawable 擁有 loaderPrivate association、visual translation 與 stamp。 State Tracker 在 [Mesa: src/mesa/state_tracker/st_manager.c:239](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L239) 呼叫 base.validate，不自行重新配置 X drawable

以下程式碼來自 [Mesa: src/gallium/frontends/dri/dri_drawable.c:106](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_drawable.c#L106)，用來顯示 `dri_st_framebuffer_validate()` 在 `out == NULL` 時只完成驗證，呼叫端要求 resources 時才逐 slot 以 `pipe_resource_reference()` 取得 `textures[statts[i]]`。 multisample resolve 另依 front／back attachment mask 交付對應 reference

```c
static bool
dri_st_framebuffer_validate(struct st_context *st,
                            struct pipe_frontend_drawable *pdrawable,
                            const enum st_attachment_type *statts,
                            unsigned count,
                            struct pipe_resource **out,
                            struct pipe_resource **resolve)
{
...
   if (!out)
      return true;

   /* Set the window-system buffers for the gallium frontend. */
   for (i = 0; i < count; i++)
      pipe_resource_reference(&out[i], textures[statts[i]]);
   if (resolve && drawable->stvis.samples > 1) {
      if (statt_mask & BITFIELD_BIT(ST_ATTACHMENT_FRONT_LEFT))
         pipe_resource_reference(resolve, drawable->textures[ST_ATTACHMENT_FRONT_LEFT]);
      else if (statt_mask & BITFIELD_BIT(ST_ATTACHMENT_BACK_LEFT))
         pipe_resource_reference(resolve, drawable->textures[ST_ATTACHMENT_BACK_LEFT]);
   }

   return true;
}
```

`textures` 陣列仍由 drawable 持有。 `pipe_resource_reference` 對每個 out slot 先處理舊 reference，再取得選定 texture 的新 reference，因此 State Tracker 收到帶有 owner reference 的 resource。 resolve output 也遵守相同規則

State Tracker 後續在 [Mesa: src/mesa/state_tracker/st_manager.c:273](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L273) 以 resource template 建立 render-target surface，validate 本身不建立 surface view

storage 的 concrete 配置仍落到 screen callback。 softpipe resource_create 實作位於 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:154](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L154)，destroy 實作位於 [Mesa: src/gallium/drivers/softpipe/sp_texture.c:207](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L207)

frontend 決定哪個 attachment 要哪個 resource，driver 決定 storage layout，refcount 串起兩端的生命週期

#### Winsys 處理 kernel／display／transport integration

Winsys 是 driver 與 platform integration 之間的窄介面，讓 softpipe 不必把 loader callback、X drawable 私有資料或 transport detail 寫進一般 rendering 路徑。 以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_screen.c:406](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.c#L406)，用來確認 `softpipe_flush_frontbuffer()` 如何把 display target、frontend pointer 與 damage boxes 交給 winsys

```c
static void
softpipe_flush_frontbuffer(struct pipe_screen *_screen,
                           struct pipe_context *pipe,
                           struct pipe_resource *resource,
                           unsigned level, unsigned layer,
                           void *context_private,
                           unsigned nboxes,
                           struct pipe_box *sub_box)
{
   struct softpipe_screen *screen = softpipe_screen(_screen);
   struct sw_winsys *winsys = screen->winsys;
   struct softpipe_resource *texture = softpipe_resource(resource);

   assert(texture->dt);
   if (texture->dt)
      winsys->displaytarget_display(winsys, texture->dt, context_private, nboxes, sub_box);
}
```

pipe_resource 在這裡只被借用。 softpipe 取出 resource 所關聯的 sw_displaytarget，再將 frontend 私有 pointer 與更新 boxes 原樣交給 winsys。 flush_frontbuffer 不取得長期 reference，也不釋放 resource 或 display target。 resource destructor 才透過 winsys 銷毀它擁有的 display target

軟體 DRI winsys 在 [Mesa: src/gallium/winsys/sw/dri/dri_sw_winsys.c:402](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/sw/dri/dri_sw_winsys.c#L402) 配置 object 並註冊 create、destroy、map、unmap、handle conversion 與 display callbacks。 `lf` 是 borrowed loader callback table pointer。 pipe-loader device 擁有 sw_winsys，softpipe screen 只保存同一 pointer，device teardown 才呼叫 destroy，因此上層必須讓 winsys 活得比 screen 久

displaytarget_display 的 concrete X 軟體路徑位於 [Mesa: src/gallium/winsys/sw/dri/dri_sw_winsys.c:349](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/sw/dri/dri_sw_winsys.c#L349)。 它依 damage boxes 選擇資料範圍，最後經 loader 函式呈現 drawable

frontend 與 winsys 分屬兩個 ownership domains：frontend 擁有 drawable 與 attachment resource references，driver resource 擁有 display target，winsys 則擁有 display-target 實作與 loader dispatch association。 State Tracker 只在 callback duration 借用 frontend drawable，並靠 pipe_resource reference 接走可跨呼叫保存的 storage

### Fence contract

`pipe_context::flush` 已把 commands 推進 driver execution 路徑，呼叫端現在需要一個可跨 context 保存與等待的 completion object。 要判斷 output slot 的舊 reference、timeout wait 與最終釋放，必須讀 `pipe_fence_handle` 的 opaque contract，以及 `pipe_screen::fence_reference`／`fence_finish` callbacks。 接著以 softpipe、llvmpipe 與 radeonsi 為例，逐項對照同一介面的實作

```callgraph
Mesa State Tracker fence request
=================================================
[Mesa: src/mesa/state_tracker/st_cb_flush.c:71] st_finish()
  │
  │  struct pipe_fence_handle *fence = NULL;
  │  st_flush(st, &fence, PIPE_FLUSH_ASYNC | PIPE_FLUSH_HINT_FINISH);
  ├─ if (fence)
  │    ├─ [Mesa: src/gallium/include/pipe/p_screen.h:415]
  │    │    screen->fence_finish(screen, NULL, fence, OS_TIMEOUT_INFINITE)
  │    │      // infinite-timeout wait 的 bool 回傳值未被 st_finish 檢查
  │    └─ [Mesa: src/gallium/include/pipe/p_screen.h:391]
  │         screen->fence_reference(screen, &fence, NULL)
  │           // wait 後必定解除呼叫端 reference
  └─ fence == NULL
       └─ skip fence callbacks
            ↓ 兩條路徑在此匯合
[Mesa: src/mesa/state_tracker/st_manager.c:1279] st_manager_flush_swapbuffers()
  │
  ├─ if (!st || !stfb || !stfb->drawable->flush_swapbuffers)
  │    └─ return
  └─ stfb->drawable->flush_swapbuffers(st, stfb->drawable)
       // 最終結果：非 NULL fence 路徑已 wait／釋放，兩條路徑都推進 swapbuffer flush
```

flush 產生的 fence 先由呼叫端 slot 持有。 fence 非 `NULL` 時，`fence_finish` 借用 handle 並接收 infinite timeout，接著 `fence_reference(..., NULL)` 解除 owner reference。 `st_finish()` 不依布林回傳值分支，兩條 fence 路徑最後都呼叫 `st_manager_flush_swapbuffers()`

#### Opaque driver fence

不同 drivers 的 completion mechanism 與 fence layout 並不相同，因此 Gallium 不能讓 State Tracker 直接依賴 fence 欄位。 以下程式碼來自 [Mesa: src/gallium/include/pipe/p_screen.h:53](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L53)，用來確認 Gallium 的公開 contract 對 `struct pipe_fence_handle` 暴露哪些資訊

```c
/** Opaque types */
struct winsys_handle;
struct pipe_fence_handle;
struct pipe_resource;
struct pipe_surface;
struct pipe_transfer;
struct pipe_box;
struct pipe_memory_info;
...
```

opaque fence 仍有明確 ownership。 `pipe_context::flush` 的 contract 在 [Mesa: src/gallium/include/pipe/p_context.h:789](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_context.h#L789) 規定 output slot 先解除舊 fence reference，再接收新的 reference

State Tracker 呼叫端 [Mesa: src/mesa/state_tracker/st_cb_flush.c:63](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L63) 將 fence output 原樣交給 pipe callback

softpipe 的 concrete producer 位於 [Mesa: src/gallium/drivers/softpipe/sp_flush.c:93](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_flush.c#L93)。 它在呼叫端要求 fence 時回傳已完成工作的 sentinel。 對 softpipe 而言 opaque pointer 不指向配置的 struct，但仍只能透過同一組 screen callbacks 使用

#### Reference 與 wait

Flush callback 把 opaque fence 放進呼叫端的 output slot 後，還要支援 slot replacement、timeout wait 與最終釋放。 以下程式碼來自 [Mesa: src/gallium/include/pipe/p_screen.h:390](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/include/pipe/p_screen.h#L390)，用來確認 `fence_reference()` 與 `fence_finish()` 的 ownership、context 與 timeout contract

```c
...
   /** Set ptr = fence, with reference counting */
   void (*fence_reference)(struct pipe_screen *screen,
                           struct pipe_fence_handle **ptr,
                           struct pipe_fence_handle *fence);
...
   /**
    * Wait for the fence to finish.
    *
    * If the fence was created with PIPE_FLUSH_DEFERRED, and the context is
    * still unflushed, and the ctx parameter of fence_finish is equal to
    * the context where the fence was created, fence_finish will flush
    * the context prior to waiting for the fence.
    *
    * In all other cases, the ctx parameter has no effect.
    *
    * \param timeout  in nanoseconds (may be OS_TIMEOUT_INFINITE).
    */
   bool (*fence_finish)(struct pipe_screen *screen,
                        struct pipe_context *ctx,
                        struct pipe_fence_handle *fence,
                        uint64_t timeout);
...
```

fence_reference 的 ptr 是 owned destination slot，fence argument 是要取得的新 reference，NULL 表示只釋放舊值。 實作必須安全處理 destination 已持有 fence 的情況。 fence_finish 的 fence 是 borrowed reference。 timeout 使用 nanoseconds，回傳值表示期限內是否完成

deferred flush 是 context ownership 的特殊情形。 只有 fence 尚未真正 flush，而且 ctx 正是建立 fence 的 context 時，fence_finish 才能先 flush 該 context。 其他情況 ctx 不影響 wait

State Tracker 的一般 finish 呼叫端位於 [Mesa: src/mesa/state_tracker/st_cb_flush.c:73](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L73)。 它先以 st_flush 取得 fence，再以 infinite timeout 呼叫 fence_finish，最後在 [Mesa: src/mesa/state_tracker/st_cb_flush.c:82](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L82) 以 fence_reference 將 local slot 設成 NULL

softpipe 提供這份 fence contract 的最短具體實作。 flush 在回傳 sentinel 前已完成軟體 cache flush，因此 `softpipe_fence_finish()` 只驗證 handle 非 `NULL` 並回傳 true，`softpipe_fence_reference()` 則直接替換 slot。 完整 callback registration 會在後文「Gallium driver 的實作形狀／Softpipe／Flush 與同步 sentinel fence」單元展開

## Gallium driver 的實作形狀

現在讓同一個齒輪 draw 分別交給 softpipe、llvmpipe 與 radeonsi。 對 application 而言，呼叫的仍是同一組 OpenGL operations，State Tracker 也仍透過 Gallium callbacks 送出 draw 與 flush； 但 `draw_vbo()` 回傳時，每種 driver 留下的結果並不相同

使用者看到的下一幀齒輪畫面可能尚未完成，即使 application 執行緒已經從 draw 回傳。 如果 application 隨即改寫同一份 resource，或呼叫 `glFinish()` 等待結果，Mesa 就必須知道 pending work 留在哪裡，以及哪個 completion point 才代表 resource 可以安全重用。 接下來從 overview 使用的 softpipe 開始，再比較 llvmpipe 與 radeonsi 如何執行相同 inputs、保存 pending work，並回傳可供呼叫端等待的 fence

| 實作 | draw callback 內的主要動作 | draw 回傳後仍可能存在的工作 | flush fence |
| --- | --- | --- | --- |
| softpipe | draw module 在呼叫端執行緒執行，結果可留在 tile cache | 沒有 worker work item，context 仍可能持有尚未寫出 storage 的 tile | 已完成 sentinel |
| llvmpipe | draw module 產生 primitive，setup 將工作分箱到 scene | scene 可排入 rasterizer worker queue | lp_fence 依 worker signal 判定完成 |
| radeonsi | 選擇 specialized draw callback，將 state 與 draw commands 寫入 gfx command buffer | command buffer 尚未提交，或提交後仍在執行 | submission 所回傳的 opaque fence |

### Softpipe 是最短的同步參考實作

State Tracker 選到 softpipe 後，`pipe_screen`／`pipe_context` callbacks 會進入呼叫端執行緒 CPU renderer。 要判斷 draw 回傳時是否仍有 worker-owned work，以及 sentinel fence 為何能立即完成，必須追 callback registration、mapped resource 的借用時間、tile cache flush 與 `softpipe_fence_finish()` 的回傳條件

```callgraph
Softpipe screen／context registration
=================================================
[Mesa: src/gallium/drivers/softpipe/sp_screen.c:440] softpipe_create_screen()
  │
  ├─ if (!screen)
  │    └─ return NULL
  ├─ screen->base.context_create = softpipe_create_context
  ├─ screen->base.flush_frontbuffer = softpipe_flush_frontbuffer
  └─ softpipe_init_screen_fence_funcs(&screen->base)
       ↓
[Mesa: src/gallium/drivers/softpipe/sp_context.c:183] softpipe_create_context()
  │
  ├─ softpipe->pipe.screen = screen
  ├─ softpipe->pipe.draw_vbo = softpipe_draw_vbo
  └─ softpipe->pipe.flush = softpipe_flush_wrapped
       // terminal object：同步 CPU execution 的 pipe_context

Softpipe draw／flush
=================================================
[Mesa: src/gallium/drivers/softpipe/sp_draw_arrays.c:61] softpipe_draw_vbo()
  │
  ├─ if (num_draws > 1)
  │    └─ util_draw_multi(...); return
  ├─ if (!indirect && (!count || !instance_count))
  │    └─ return
  ├─ if (!softpipe_check_render_cond(sp))
  │    └─ return
  └─ map vertex／index resources。 呼叫端執行緒執行 draw module
       // tile caches 保存尚待寫出的 color／depth data
       ↓
[Mesa: src/gallium/drivers/softpipe/sp_flush.c:47] softpipe_flush()
  │
  ├─ draw_flush(softpipe->draw)
  ├─ if (flags & SP_FLUSH_TEXTURE_CACHE)
  │    └─ flush sampler tile caches
  ├─ flush color／depth tile caches
  └─ if (fence)
       └─ *fence = (void *)(intptr_t)1
            ↓
[Mesa: src/gallium/drivers/softpipe/sp_fence.c:44] softpipe_fence_finish()
  │
  └─ assert(fence); return true
       // 最終結果：同步 cache flush 完成，sentinel fence 立即 signaled
```

softpipe 的 draw 與 cache writeback 都在呼叫端執行緒推進，flush 回傳前已完成相關軟體工作。 output fence 因而可用立即 signaled sentinel 表示，而 State Tracker 仍照標準 reference／finish callback 走完整生命週期

#### Screen callback registration

Screen registration 必須把 frontend 可見的 `pipe_screen` identity 與 softpipe 的 adapter-level 私有 state 接在一起。 以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_screen.h:40](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.h#L40)，用來確認 `struct softpipe_screen` 如何組合 Gallium base、winsys、跨 context timestamp 與 execution option

```c
struct softpipe_screen {
   struct pipe_screen base;

   struct sw_winsys *winsys;

   /* Increments whenever textures are modified.  Contexts can track
    * this.
    */
   unsigned timestamp;
   bool use_llvm;
};

static inline struct softpipe_screen *
softpipe_screen( struct pipe_screen *pipe )
{
   return (struct softpipe_screen *)pipe;
}
```

`pipe_screen base` 是 frontend 可見的 object identity，`softpipe_screen` 配置才是 driver 擁有的完整 screen。 `winsys` pointer 由建立 screen 的上層持有，softpipe screen 只借用。 `timestamp` 提供跨 context 的 resource change observation，`use_llvm` 則保留建立 draw context 時會用到的 screen-level choice

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_screen.c:451](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.c#L451)，用來顯示 `softpipe_create_screen()` 在這裡將 `destroy`、format query、`context_create` 與 `flush_frontbuffer` 寫入 `screen->base`，逐 stage 指派 `sp_compiler_options`，再由 texture／fence init helpers 補齊其餘 callback groups

```c
struct pipe_screen *
softpipe_create_screen(struct sw_winsys *winsys)
{
...
   screen->base.destroy = softpipe_destroy_screen;

   screen->base.get_name = softpipe_get_name;
   screen->base.get_vendor = softpipe_get_vendor;
   screen->base.get_device_vendor = softpipe_get_vendor; // TODO should be the CPU vendor
   screen->base.get_screen_fd = softpipe_screen_get_fd;
   screen->base.get_timestamp = u_default_get_timestamp;
   screen->base.query_memory_info = util_sw_query_memory_info;
   screen->base.is_format_supported = softpipe_is_format_supported;
   screen->base.context_create = softpipe_create_context;
   screen->base.flush_frontbuffer = softpipe_flush_frontbuffer;
   screen->use_llvm = sp_debug & SP_DBG_USE_LLVM;

   for (unsigned i = 0; i <= MESA_SHADER_COMPUTE; i++)
      screen->base.nir_options[i] = &sp_compiler_options;

   softpipe_init_screen_texture_funcs(&screen->base);
   softpipe_init_screen_fence_funcs(&screen->base);
...
}
```

這裡沒有另一份 softpipe-specific dispatch protocol。 context_create、resource callbacks、front-buffer callback 與 fence callbacks 全部填入上一章定義的 pipe_screen slots。 texture 與 fence 函式由 helper 成組註冊，其他基本 callbacks 直接寫入 base

State Tracker 在 [Mesa: src/mesa/state_tracker/st_manager.c:1005](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L1005) 呼叫 pipe_screen::context_create，在 [Mesa: src/mesa/state_tracker/st_texture.c:106](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_texture.c#L106) 呼叫 resource_create。 兩個呼叫端都不知道 callback 指向 softpipe 函式，只遵守 pipe contract

`softpipe_destroy_screen()` 位於 [Mesa: src/gallium/drivers/softpipe/sp_screen.c:397](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_screen.c#L397)，只釋放 `softpipe_screen` object。 winsys 生命週期由 screen 外層的建立流程管理，這與前述 frontend／winsys 邊界的 ownership 說明一致

#### Context callback registration

每個 OpenGL context 都需要一份獨立的 softpipe mutable state 與 command callback table，而 State Tracker 只會持有公開的 `pipe_context` pointer。 以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_context.h:54](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_context.h#L54)，用來確認 `struct softpipe_context` 如何在同一個 object 中容納 Gallium base、CSO handles、dynamic state、resource bindings 與軟體 cache

```c
struct softpipe_context {
   struct pipe_context pipe;  /**< base class */

   /** Constant state objects */
   struct pipe_blend_state *blend;
   struct pipe_sampler_state *samplers[MESA_SHADER_STAGES][PIPE_MAX_SAMPLERS];
   struct pipe_depth_stencil_alpha_state *depth_stencil;
   struct pipe_rasterizer_state *rasterizer;
   struct sp_fragment_shader *fs;
   struct sp_fragment_shader_variant *fs_variant;
   struct sp_vertex_shader *vs;
   struct sp_geometry_shader *gs;
   struct sp_velems_state *velems;
   struct sp_so_state *so;
   struct sp_compute_shader *cs;

   /** Other rendering state */
   struct pipe_blend_color blend_color;
   struct pipe_blend_color blend_color_clamped;
   struct pipe_stencil_ref stencil_ref;
   struct pipe_clip_state clip;
   struct pipe_resource *constants[MESA_SHADER_STAGES][PIPE_MAX_CONSTANT_BUFFERS];
   struct pipe_framebuffer_state framebuffer;
   struct pipe_scissor_state scissors[PIPE_MAX_VIEWPORTS];
   struct pipe_sampler_view *sampler_views[MESA_SHADER_STAGES][PIPE_MAX_SHADER_SAMPLER_VIEWS];

   struct pipe_image_view images[MESA_SHADER_STAGES][PIPE_MAX_SHADER_IMAGES];
   struct pipe_shader_buffer buffers[MESA_SHADER_STAGES][PIPE_MAX_SHADER_BUFFERS];
   struct pipe_viewport_state viewports[PIPE_MAX_VIEWPORTS];
   struct pipe_vertex_buffer vertex_buffer[PIPE_MAX_ATTRIBS];
...
```

`pipe_context` 是唯一交給 State Tracker 的 pointer。 其後欄位分成 immutable state object handles、by-value dynamic state 與持有 reference 的 resource／view bindings。 context destroy 必須在釋放整個 object 前解除這些 references，也必須銷毀由該 context 建立的 draw module、upload manager 與 caches

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_context.c:204](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_context.c#L204)，用來顯示這個 `softpipe_create_context()` 片段先連接 borrowed `screen`／`priv` 與 `softpipe_destroy`，再分組註冊 state setters。 execution slots 則明確設為 `softpipe_set_framebuffer_state`、`softpipe_draw_vbo` 與 `softpipe_flush_wrapped`

```c
struct pipe_context *
softpipe_create_context(struct pipe_screen *screen, void *priv,
                        unsigned flags)
{
...
   softpipe->pipe.screen = screen;
   softpipe->pipe.destroy = softpipe_destroy;
   softpipe->pipe.priv = priv;

   /* state setters */
   softpipe_init_blend_funcs(&softpipe->pipe);
   softpipe_init_clip_funcs(&softpipe->pipe);
   softpipe_init_query_funcs( softpipe );
   softpipe_init_rasterizer_funcs(&softpipe->pipe);
   softpipe_init_sampler_funcs(&softpipe->pipe);
   softpipe_init_shader_funcs(&softpipe->pipe);
   softpipe_init_streamout_funcs(&softpipe->pipe);
   softpipe_init_texture_funcs( &softpipe->pipe );
   softpipe_init_vertex_funcs(&softpipe->pipe);
   softpipe_init_image_funcs(&softpipe->pipe);

   softpipe->pipe.set_framebuffer_state = softpipe_set_framebuffer_state;
   softpipe->pipe.set_debug_callback = u_default_set_debug_callback;

   softpipe->pipe.draw_vbo = softpipe_draw_vbo;

   softpipe->pipe.launch_grid = softpipe_launch_grid;

   softpipe->pipe.clear = softpipe_clear;
   softpipe->pipe.flush = softpipe_flush_wrapped;
   softpipe->pipe.texture_barrier = softpipe_texture_barrier;
   softpipe->pipe.memory_barrier = softpipe_memory_barrier;
   softpipe->pipe.render_condition = softpipe_render_condition;
...
}
```

State setters 依功能群組註冊，`draw_vbo` 與 `flush` 則直接填入最重要的 execution slots。 `screen` pointer 是非擁有關係，`priv` 是 frontend 傳入的 borrowed pointer。 `softpipe_create_context()` 在完成 cache 與 draw-stage 建立後，於 [Mesa: src/gallium/drivers/softpipe/sp_context.c:332](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_context.c#L332) 回傳 embedded `pipe_context`

destroy callback 的 concrete 清理從 [Mesa: src/gallium/drivers/softpipe/sp_context.c:59](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_context.c#L59) 開始。 它先銷毀 blitter、draw stages、upload manager 與 caches，再解除 framebuffer、sampler view、constant resource 與 vertex buffer references，最後才 free softpipe_context

#### Draw

State Tracker 最後由 [Mesa: src/mesa/state_tracker/st_draw.c:104](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_draw.c#L104) 的 `cso_draw_vbo()` 進入 softpipe draw callback。 以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_draw_arrays.c:61](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_draw_arrays.c#L61)，用來追蹤 `softpipe_draw_vbo()` 如何篩選特殊 draw 路徑，並把主要路徑交給目前的軟體 rendering state

```c
void
softpipe_draw_vbo(struct pipe_context *pipe,
                  const struct pipe_draw_info *info,
                  unsigned drawid_offset,
                  const struct pipe_draw_indirect_info *indirect,
                  const struct pipe_draw_start_count_bias *draws,
                  unsigned num_draws)
{
   if (num_draws > 1) {
      util_draw_multi(pipe, info, drawid_offset, indirect, draws, num_draws);
      return;
   }

   if (!indirect && (!draws[0].count || !info->instance_count))
      return;

   struct softpipe_context *sp = softpipe_context(pipe);
   struct draw_context *draw = sp->draw;
   const void *mapped_indices = NULL;
   unsigned i;

   if (!softpipe_check_render_cond(sp))
      return;

   if (indirect && indirect->buffer) {
      util_draw_indirect(pipe, info, drawid_offset, indirect);
      return;
   }

   sp->reduced_api_prim = u_reduced_prim(info->mode);

   if (sp->dirty) {
      softpipe_update_derived(sp, sp->reduced_api_prim);
   }
...
}
```

`num_draws > 1` 與 indirect draw 分支先經 Gallium utility 正規化，空 draw 與 render condition 失敗則直接回傳。 真正進入主要路徑後，`softpipe_context` 供應目前 draw context 與 dirty state。 `softpipe_update_derived()` 將先前 setters 累積的 mutable state 轉成這次 draw 可直接使用的 derived state

接著函式將 vertex 與 index resources 映射成 draw module 可讀取的 CPU pointers。 這些 mappings 在 callback duration 內借用。 resource ownership 仍由 softpipe context bindings 與 draw_info references 維持，draw module 不接走 storage 生命週期

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_draw_arrays.c:140](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_draw_arrays.c#L140)，用來顯示 `softpipe_draw_vbo()` 呼叫 draw module 後清除 mapped vertex／index pointers，必要時清理 LLVM sampling，再以 `draw_flush()` 結束對 transient mappings 的借用。 surfaces 仍保持 mapped，所以將 `sp->dirty_render_cache` 設為 true

```c
void
softpipe_draw_vbo(struct pipe_context *pipe,
                  const struct pipe_draw_info *info,
                  unsigned drawid_offset,
                  const struct pipe_draw_indirect_info *indirect,
                  const struct pipe_draw_start_count_bias *draws,
                  unsigned num_draws)
{
...
   draw_collect_pipeline_statistics(draw,
                                    sp->active_statistics_queries > 0);

   /* draw! */
   draw_vbo(draw, info, drawid_offset, indirect, draws, num_draws, 0);

   /* unmap vertex/index buffers - will cause draw module to flush */
   for (i = 0; i < sp->num_vertex_buffers; i++) {
      draw_set_mapped_vertex_buffer(draw, i, NULL, 0);
   }
   if (mapped_indices) {
      draw_set_indexes(draw, NULL, 0, 0);
   }

   if (softpipe_screen(sp->pipe.screen)->use_llvm) {
      softpipe_cleanup_vertex_sampling(sp);
      softpipe_cleanup_geometry_sampling(sp);
   }

   /*
    * TODO: Flush only when a user vertex/index buffer is present
    * (or even better, modify draw module to do this
    * internally when this condition is seen?)
    */
   draw_flush(draw);

   /* Note: leave drawing surfaces mapped */
   sp->dirty_render_cache = true;
}
```

`draw_vbo` 在同一呼叫端執行緒進入 draw module，primitive 隨即依序經過軟體 stages。 清空 mapped vertex 與 index pointers 後，`draw_flush` 會結束 draw module 對這些 borrowed mappings 的使用。 drawing surfaces 維持 mapped，render cache 以 `dirty_render_cache` 記錄仍有 tile data 待處理

這裡的同步描述 execution owner：callback 在呼叫端執行緒執行 CPU draw stages。 context-owned tile caches 仍可把 pixel write 延後到後續 flush、state transition 或 hazard handling

#### Flush 與同步 sentinel fence

State Tracker 的 [Mesa: src/mesa/state_tracker/st_cb_flush.c:77](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L77) `st_finish()` 會要求 softpipe 收束 draw module 與 context caches，再沿標準 fence contract 完成等待。 以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_flush.c:46](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_flush.c#L46)，用來追蹤 `softpipe_flush()` 如何排空 draw、texture 與 render caches

```c
void
softpipe_flush( struct pipe_context *pipe,
                unsigned flags,
                struct pipe_fence_handle **fence )
{
   struct softpipe_context *softpipe = softpipe_context(pipe);
   uint i;

   draw_flush(softpipe->draw);

   if (flags & SP_FLUSH_TEXTURE_CACHE) {
      unsigned sh;

      for (sh = 0; sh < ARRAY_SIZE(softpipe->tex_cache); sh++) {
         for (i = 0; i < softpipe->num_sampler_views[sh]; i++) {
            sp_flush_tex_tile_cache(softpipe->tex_cache[sh][i]);
         }
      }
   }

   /* If this is a swapbuffers, just flush color buffers.
    *
    * The zbuffer changes are not discarded, but held in the cache
    * in the hope that a later clear will wipe them out.
    */
   for (i = 0; i < softpipe->framebuffer.nr_cbufs; i++)
      if (softpipe->cbuf_cache[i])
         sp_flush_tile_cache(softpipe->cbuf_cache[i]);

   if (softpipe->zsbuf_cache)
      sp_flush_tile_cache(softpipe->zsbuf_cache);

   softpipe->dirty_render_cache = false;
...
}
```

`draw_flush()` 先讓 draw module 停止使用 transient mappings。 texture caches、color tile caches 與 depth stencil tile cache 隨後依 flush flags 寫出。 `dirty_render_cache` 清成 false 時，這個 softpipe context 已沒有等待另一條 execution queue 完成的 rendering work

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_flush.c:93](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_flush.c#L93)，用來顯示 `softpipe_flush()` 只有在呼叫端提供 `fence` slot 時才寫入 `(void *)(intptr_t)1` sentinel，`softpipe_flush_wrapped()` 則忽略公開 flags 並固定要求 `SP_FLUSH_TEXTURE_CACHE`，證明這個 handle 在 callback 回傳前已完成

```c
void
softpipe_flush(struct pipe_context *pipe, unsigned flags,
               struct pipe_fence_handle **fence)
{
...
   if (fence)
      *fence = (void*)(intptr_t)1;
}

void
softpipe_flush_wrapped(struct pipe_context *pipe,
                       struct pipe_fence_handle **fence,
                       unsigned flags)
{
   softpipe_flush(pipe, SP_FLUSH_TEXTURE_CACHE, fence);
}
```

`(void *)(intptr_t)1` sentinel 不是 allocated fence object。 它只提供 non-NULL identity，表示呼叫端要求 fence，而且 synchronous softpipe flush 已在回傳前完成。 wrapper 將公開的 pipe flags 收斂成 softpipe 的 texture-cache flush 路徑，registration 中的 `pipe_context::flush` 正是這個函式

以下程式碼來自 [Mesa: src/gallium/drivers/softpipe/sp_fence.c:34](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_fence.c#L34)，用來顯示對 `softpipe_flush()` 產生的 sentinel，`softpipe_fence_reference()` 以直接賦值完成 slot replacement，`softpipe_fence_finish()` 不等待且回傳 true。 `softpipe_init_screen_fence_funcs()` 讓 State Tracker 仍能走標準 fence callbacks

```c
static void
softpipe_fence_reference(struct pipe_screen *screen,
                         struct pipe_fence_handle **ptr,
                         struct pipe_fence_handle *fence)
{
   *ptr = fence;
}


static bool
softpipe_fence_finish(struct pipe_screen *screen,
                      struct pipe_context *ctx,
                      struct pipe_fence_handle *fence,
                      uint64_t timeout)
{
   assert(fence);
   return true;
}


void
softpipe_init_screen_fence_funcs(struct pipe_screen *screen)
{
   screen->fence_reference = softpipe_fence_reference;
   screen->fence_finish = softpipe_fence_finish;
}
```

reference callback 不增減 counter，因為 sentinel 不需要動態配置。 finish 也不進行 wait，只驗證 handle 非 NULL 後回傳 true。 這個最短實作仍完整履行 Gallium callback shape，State Tracker 不需要為同步 driver 加入特例

ownership 順序可以精確描述為：flush output slot 取得 sentinel，`fence_finish` 借用 sentinel，`fence_reference` 將 slot 設為 NULL。 沒有動態配置的 fence object 需要釋放，也沒有 worker reference 要回收。 這正是下一節與 llvmpipe 真正 fence object 對照的基準

### llvmpipe 使用相同 contract，但有 worker／fence

State Tracker 改選 llvmpipe 時，公開 callback signatures 保持相同，但 `llvmpipe_screen` 擁有 rasterizer workers，context setup 則建立可排隊的 scenes。 要判斷 draw／flush 的非同步 handoff 與 fence signal 時點，必須從 `llvmpipe_draw_vbo()` 追到 `lp_setup_rasterize_scene()`、`lp_rast_queue_scene()` 與 `lp_fence_signal()`

```callgraph
Llvmpipe context／draw 入口
=================================================
[Mesa: src/gallium/drivers/llvmpipe/lp_context.c:248] llvmpipe_create_context()
  │
  ├─ if (!llvmpipe_screen_late_init(lp_screen))
  │    └─ return NULL
  ├─ if (!align_malloc(...))
  │    └─ return NULL
  ├─ llvmpipe->pipe.flush = do_flush
  └─ llvmpipe_init_draw_funcs(llvmpipe)
       // terminal object：帶 setup／rasterizer state 的 pipe_context
       ↓
[Mesa: src/gallium/drivers/llvmpipe/lp_draw_arrays.c:54] llvmpipe_draw_vbo()
  │
  ├─ if (!indirect && (!count || !instance_count))
  │    └─ return
  ├─ if (!llvmpipe_check_render_cond(lp))
  │    └─ return
  ├─ if (indirect && indirect->buffer)
  │    └─ util_draw_indirect(...); return
  └─ map vertex／index resources。 draw module 將 primitives 送入 setup
       ↓

Llvmpipe setup／worker 邊界
=================================================
[Mesa: src/gallium/drivers/llvmpipe/lp_setup.c:230] lp_setup_rasterize_scene()
  │
  ├─ lp_scene_end_binning(scene)
  ├─ lp_rast_queue_scene(screen->rast, scene)
  └─ lp_setup_reset(setup)
       // handoff object：lp_scene + scene fence
       ↓
[Mesa: src/gallium/drivers/llvmpipe/lp_rast.c:1108] lp_rast_queue_scene()
  │
  ├─ rast->last_fence = scene->fence。 fence->issued = true
  ├─ if (rast->num_threads == 0)
  │    └─ 呼叫端執行緒直接處理 scene
  └─ workers 存在
       └─ scene 排入 rasterizer queue
            ↓
[Mesa: src/gallium/drivers/llvmpipe/lp_rast.c:1096] scene completion
  │
  └─ if (scene->fence) lp_fence_signal(scene->fence)
       // 最終結果：lp_fence 的 signalled condition 可由 fence_finish 等待

Llvmpipe explicit flush
=================================================
[Mesa: src/gallium/drivers/llvmpipe/lp_flush.c:50] llvmpipe_flush()
  │
  ├─ draw_flush(llvmpipe->draw)
  ├─ lp_setup_flush(llvmpipe->setup, reason)
  ├─ lp_rast_fence(screen->rast, fence)
  └─ if (fence && !*fence)
       └─ *fence = lp_fence_create(0)
            // 最終結果：呼叫端取得代表 queued scenes 的 fence
```

llvmpipe 把 scene ownership 交給 rasterizer queue，worker signal 使 fence count 朝 rank 前進。 flush 回傳的 `lp_fence` 讓呼叫端在 draw 執行緒之外觀察 completion，empty queue 也以 rank 0 fence 履行相同 contract

#### Screen 與 context

Llvmpipe 同樣以 Gallium base 對接 frontend，但 screen 還要保存 rasterizer 與 worker 設定，context 則持有各自的 draw、setup 與 mutable bindings。 以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_screen.c:1024](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_screen.c#L1024)，用來確認 `llvmpipe_create_screen()` 如何安裝 callbacks 並決定 screen-owned rasterizer 的 worker count

```c
struct pipe_screen *
llvmpipe_create_screen(struct sw_winsys *winsys)
{
...
   screen->base.destroy = llvmpipe_destroy_screen;

   screen->base.get_name = llvmpipe_get_name;
   screen->base.get_vendor = llvmpipe_get_vendor;
   screen->base.get_device_vendor = llvmpipe_get_vendor; // TODO should be the CPU vendor
   screen->base.get_screen_fd = llvmpipe_screen_get_fd;
   screen->base.is_format_supported = llvmpipe_is_format_supported;
   screen->base.get_sample_pixel_grid = llvmpipe_get_sample_pixel_grid;

   screen->base.context_create = llvmpipe_create_context;
   screen->base.flush_frontbuffer = llvmpipe_flush_frontbuffer;
   screen->base.fence_reference = llvmpipe_fence_reference;
   screen->base.fence_finish = llvmpipe_fence_finish;

   screen->base.get_timestamp = u_default_get_timestamp;

   screen->base.query_memory_info = util_sw_query_memory_info;

   screen->base.get_driver_uuid = llvmpipe_get_driver_uuid;
   screen->base.get_device_uuid = llvmpipe_get_device_uuid;

   screen->base.finalize_nir = llvmpipe_finalize_nir;

   screen->base.get_disk_shader_cache = lp_get_disk_shader_cache;
   llvmpipe_init_screen_resource_funcs(&screen->base);

   screen->num_threads = util_get_cpu_caps()->nr_cpus > 1
      ? util_get_cpu_caps()->nr_cpus : 0;
   screen->num_threads = debug_get_num_option("LP_NUM_THREADS",
                                              screen->num_threads);
   screen->num_threads = MIN2(screen->num_threads, LP_MAX_THREADS);
...
}
```

`context_create`、resource、fence 與 front-buffer slots 仍是上一章的 contract。 `num_threads` 不屬於 `pipe_screen` 公開 state，而是 `llvmpipe_screen` 的 scheduling choice。 screen 建立流程後段的初始化會在 [Mesa: src/gallium/drivers/llvmpipe/lp_screen.c:968](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_screen.c#L968) 依這個數量建立 `lp_rasterizer`，所有 llvmpipe contexts 共用該 screen-owned execution resource

以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_context.c:283](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_context.c#L283)，用來顯示 `llvmpipe_create_context()` 保存 borrowed screen，並在同一 `pipe_context` 註冊 flush、draw、state 與 resource callbacks

```c
struct pipe_context *
llvmpipe_create_context(struct pipe_screen *screen, void *priv,
                        unsigned flags)
{
...
   llvmpipe->pipe.screen = screen;
   llvmpipe->pipe.priv = priv;

   /* Init the pipe context methods */
   llvmpipe->pipe.destroy = llvmpipe_destroy;
   llvmpipe->pipe.set_framebuffer_state = llvmpipe_set_framebuffer_state;
   llvmpipe->pipe.clear = llvmpipe_clear;
   llvmpipe->pipe.flush = do_flush;
   llvmpipe->pipe.texture_barrier = llvmpipe_texture_barrier;

   llvmpipe->pipe.render_condition = llvmpipe_render_condition;
   llvmpipe->pipe.render_condition_mem = llvmpipe_render_condition_mem;

   llvmpipe->pipe.fence_server_sync = llvmpipe_fence_server_sync;
   llvmpipe->pipe.get_device_reset_status = llvmpipe_get_device_reset_status;
   llvmpipe_init_blend_funcs(llvmpipe);
   llvmpipe_init_clip_funcs(llvmpipe);
   llvmpipe_init_draw_funcs(llvmpipe);
   llvmpipe_init_compute_funcs(llvmpipe);
   llvmpipe_init_sampler_funcs(llvmpipe);
   llvmpipe_init_query_funcs(llvmpipe);
   llvmpipe_init_vertex_funcs(llvmpipe);
   llvmpipe_init_so_funcs(llvmpipe);
   llvmpipe_init_fs_funcs(llvmpipe);
   llvmpipe_init_vs_funcs(llvmpipe);
   llvmpipe_init_gs_funcs(llvmpipe);
   llvmpipe_init_tess_funcs(llvmpipe);
   llvmpipe_init_task_funcs(llvmpipe);
   llvmpipe_init_mesh_funcs(llvmpipe);
   llvmpipe_init_rasterizer_funcs(llvmpipe);
   llvmpipe_init_context_resource_funcs(&llvmpipe->pipe);
   llvmpipe_init_surface_functions(llvmpipe);
...
}
```

do_flush、draw group、state setters 與 resource callbacks 仍填入 `pipe_context` slots。 context object 擁有 draw、setup、uploader 與 bindings，screen 則擁有 rasterizer workers

建立流程在 [Mesa: src/gallium/drivers/llvmpipe/lp_context.c:355](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_context.c#L355) 將 lp_setup_context 接到 draw module，最後於 [Mesa: src/gallium/drivers/llvmpipe/lp_context.c:412](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_context.c#L412) 回傳 embedded pipe_context

這個 ownership split 允許多個 contexts 各自 bin scenes，卻共用同一 screen rasterizer。 context destroy 要釋放尚持有的 setup 與 state references，screen destroy 則必須等 worker infrastructure 停止後才釋放 rasterizer

#### Draw pipeline

Llvmpipe context 已綁定 shader、resource 與 framebuffer state，接下來要把 primitives 轉成 setup／rasterizer 能消費的 scene work。 以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_draw_arrays.c:141](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_draw_arrays.c#L141)，用來追蹤 `llvmpipe_draw_vbo()` 如何把 borrowed draw parameters 交給共用 draw module 與 setup rasterize stage

```c
static void
llvmpipe_draw_vbo(struct pipe_context *pipe,
                  const struct pipe_draw_info *info,
                  unsigned drawid_offset,
                  const struct pipe_draw_indirect_info *indirect,
                  const struct pipe_draw_start_count_bias *draws,
                  unsigned num_draws)
{
...
   draw_collect_pipeline_statistics(draw,
                                    lp->active_statistics_queries > 0 &&
                                    !lp->queries_disabled);

   draw_collect_primitives_generated(draw,
                                     lp->active_primgen_queries &&
                                     !lp->queries_disabled);

   /* draw! */
   draw_vbo(draw, info, drawid_offset, indirect, draws, num_draws,
            lp->patch_vertices);
...
}
```

這個 draw_vbo 與 softpipe 使用相同 draw module 介面，但 rasterization backend 不同。 lp_setup_create 在 [Mesa: src/gallium/drivers/llvmpipe/lp_setup.c:1406](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_setup.c#L1406) 將 screen 的 num_threads 保存到 setup，並把 setup vbuf stage 設成 draw module 的 rasterize stage

以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_setup.c:235](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_setup.c#L235)，用來顯示 `lp_setup_rasterize_scene()` 先把 active query pointers 複製進 `scene` 並呼叫 `lp_scene_end_binning()`，持有 `rast_mutex` 時以 `lp_rast_queue_scene()` 把 scene 交給 screen rasterizer，最後 `lp_setup_reset()` 讓 context 可開始另一個 scene

```c
static void
lp_setup_rasterize_scene(struct lp_setup_context *setup)
{
...
   scene->num_active_queries = setup->active_binned_queries;
   memcpy(scene->active_queries, setup->active_queries,
          scene->num_active_queries * sizeof(scene->active_queries[0]));

   lp_scene_end_binning(scene);

   mtx_lock(&screen->rast_mutex);
   lp_rast_queue_scene(screen->rast, scene);
   mtx_unlock(&screen->rast_mutex);

   lp_setup_reset(setup);

   LP_DBG(DEBUG_SETUP, "%s done \n", __func__);
}
```

交接前，`setup` 擁有正在 bin 的 `scene`。 `lp_scene_end_binning()` 固定其 command bins，`lp_rast_queue_scene()` 接著讓 rasterizer 管理 pending scene。 `lp_setup_reset()` 解除 context 對目前 scene 的 active-building ownership，之後 context 可以開始準備另一個 scene

以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_rast.c:1134](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_rast.c#L1134)，用來顯示 `lp_rast_queue_scene()` 的 threaded 分支將 `scene` 放入 `full_scenes` queue，並逐 worker signal `work_ready` semaphore。 沒有 workers 的另一分支則在呼叫端執行緒處理完 scene 並將 `rast->curr_scene` 清成 `NULL`

```c
void
lp_rast_queue_scene(struct lp_rasterizer *rast, struct lp_scene *scene)
{
...
   if (rast->num_threads == 0) {
      ...
      rast->curr_scene = NULL;
   } else {
      /* threaded rendering! */
      lp_scene_enqueue(rast->full_scenes, scene);

      /* signal the threads that there's work to do */
      for (unsigned i = 0; i < rast->num_threads; i++) {
         util_semaphore_signal(&rast->tasks[i].work_ready);
      }
   }
...
}
```

`scene` 進入 `full_scenes` queue 後，worker semaphore 取得新 work。 執行緒入口在 [Mesa: src/gallium/drivers/llvmpipe/lp_rast.c:1187](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_rast.c#L1187) 等待 `work_ready`、共同取得目前 scene，再各自執行 `rasterize_scene`

num_threads 為零時，同一 lp_rast_queue_scene 會直接在呼叫端執行緒 rasterize scene。 Gallium contract 沒有改變，差異只在 llvmpipe_screen 的 worker 組態。 啟用 workers 時，draw 或 scene flush 可以在 raster work 完成前回傳，completion ownership 因而需要真正的 fence

#### Flush 與真正的 asynchronous fence

Draw 可能已把 scene 排入 rasterizer workers，因此 flush 必須推進 queued work，並把可等待的 completion object 交回呼叫端。 以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_flush.c:49](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_flush.c#L49)，用來追蹤 `llvmpipe_flush()` 如何連接 draw flush、scene submission 與 fence publication

```c
void
llvmpipe_flush(struct pipe_context *pipe,
               struct pipe_fence_handle **fence,
               const char *reason)
{
   struct llvmpipe_context *llvmpipe = llvmpipe_context(pipe);
   struct llvmpipe_screen *screen = llvmpipe_screen(pipe->screen);

   draw_flush(llvmpipe->draw);

   /* ask the setup module to flush */
   lp_setup_flush(llvmpipe->setup, reason);

   mtx_lock(&screen->rast_mutex);
   lp_rast_fence(screen->rast, (struct lp_fence **)fence);
   mtx_unlock(&screen->rast_mutex);

   if (fence && (!*fence))
      *fence = (struct pipe_fence_handle *)lp_fence_create(0);

   llvmpipe_clear_sample_functions_cache(llvmpipe, fence);
...
}
```

lp_setup_flush 會把可提交的 scene 推進 queue。 lp_rast_fence 再將 rasterizer::last_fence 的 reference 放入呼叫端 output slot。 若這次沒有 queued scene，driver 仍建立 rank 0 的 lp_fence，提供已完成但仍是動態配置、具有 refcount 的 fence object。 這與 softpipe 的整數 sentinel 不同

lp_fence 的欄位位於 [Mesa: src/gallium/drivers/llvmpipe/lp_fence.h:47](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_fence.h#L47)。 reference、mutex、condition variable、issued、rank 與 count 都是 fence object 的欄位

scene 在 [Mesa: src/gallium/drivers/llvmpipe/lp_setup.c:261](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_setup.c#L261) 以 worker rank 建立 fence，每個 worker 完成 scene 時會在 [Mesa: src/gallium/drivers/llvmpipe/lp_rast.c:1096](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_rast.c#L1096) 呼叫 lp_fence_signal

以下程式碼來自 [Mesa: src/gallium/drivers/llvmpipe/lp_screen.c:834](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_screen.c#L834)，用來顯示 `llvmpipe_fence_reference()` 委派 `lp_fence_reference()` 增減 refcount。 `llvmpipe_fence_finish()` 對 timeout 0 只輪詢，有限 timeout 呼叫 `lp_fence_timedwait()`，`OS_TIMEOUT_INFINITE` 則進入 `lp_fence_wait()`

```c
static void
llvmpipe_fence_reference(struct pipe_screen *screen,
                         struct pipe_fence_handle **ptr,
                         struct pipe_fence_handle *fence)
{
   struct lp_fence **old = (struct lp_fence **) ptr;
   struct lp_fence *f = (struct lp_fence *) fence;

   lp_fence_reference(old, f);
}


/**
 * Wait for the fence to finish.
 */
static bool
llvmpipe_fence_finish(struct pipe_screen *screen,
                      struct pipe_context *ctx,
                      struct pipe_fence_handle *fence_handle,
                      uint64_t timeout)
{
   struct lp_fence *f = (struct lp_fence *) fence_handle;

   if (!timeout)
      return lp_fence_signalled(f);

   if (!lp_fence_signalled(f)) {
      if (timeout != OS_TIMEOUT_INFINITE)
         return lp_fence_timedwait(f, timeout);

      lp_fence_wait(f);
   }
   return true;
}
```

reference callback 轉入 lp_fence_reference，會增減 pipe_reference 並在最後一個 reference 消失時銷毀 fence。 finish 的 timeout 0 路徑只輪詢，有限 timeout 進 timed wait，infinite timeout 則進 condition-variable wait。 State Tracker 的 st_finish 呼叫端不需知道這些分支

worker 每完成一份 scene work 就增加 count，count 達到 rank 才算 signalled。 scene、rasterizer::last_fence 與 frontend output slot 可以同時持有 references，任何一方釋放都不會讓仍在執行的 worker 看到 dangling fence。 最後一個 owner 解除 reference 後，lp_fence_destroy 才銷毀 mutex 與 condition variable，並釋放 fence object 本體

llvmpipe 的非同步性有明確條件。 screen 建立了 workers，而且 scene 已排入 queue 時，flush 回傳的 fence 可能仍未 signalled。 num_threads 為零時會同步 rasterize，rank 0 fallback 也已完成，但兩條路徑仍共享相同 pipe_fence_handle contract

### Radeonsi 硬體 driver 對照

State Tracker 選到 radeonsi 時，draw callback 會把 `pipe_draw_info`、bound shaders 與 resource references 編進 `si_context::gfx_cs`，flush 再交給 winsys。 要判斷 draw 回傳、command submission 與硬體 completion 三個時點，必須讀 selected draw callback、packet emission、`si_flush_gfx_cs()` 的 reentrancy predicate 與 `last_gfx_fence` publication

```callgraph
Radeonsi Gallium draw callback
=================================================
[Mesa: src/gallium/drivers/radeonsi/si_state_draw.cpp:2635] si_draw_vbo()
  │
  └─ si_draw(ctx, info, drawid_offset, indirect, draws, num_draws, ...)
       // handoff：pipe_draw_info + bound shader/resource state
       ↓
[Mesa: src/gallium/drivers/radeonsi/si_state_draw.cpp:1431] si_emit_draw_packets()
  │
  ├─ indexed draw
  │    └─ emit index-buffer 位址／count packets
  ├─ indirect draw
  │    └─ emit indirect argument packets
  └─ direct draw
       └─ emit primitive／instance／draw packets into sctx->gfx_cs
            // terminal draw 結果：gfx_cs 累積 device commands 與 BO references

Radeonsi State Tracker flush callback
=================================================
[Mesa: src/gallium/drivers/radeonsi/si_fence.c:520] si_flush_from_st()
  │
  └─ si_flush_gfx_cs(sctx, translated_flags, fence)
       ↓
[Mesa: src/gallium/drivers/radeonsi/si_gfx_cs.c:78] si_flush_gfx_cs()
  │
  ├─ if (ctx->gfx_flush_in_progress)
  │    └─ return
  ├─ 依 sharing／debug／async conditions 更新 flags
  └─ ws->cs_flush(&ctx->gfx_cs, flags, &ctx->last_gfx_fence)
       // 行程/UAPI handoff 由 radeonsi winsys 負責
       ↓
[Mesa: src/gallium/drivers/radeonsi/si_gfx_cs.c:212] fence publication
  │
  ├─ if (fence)
  │    └─ ws->fence_reference(ws, fence, ctx->last_gfx_fence)
  └─ ctx->num_gfx_cs_flushes++
       // 最終結果：command submission 已交給 winsys，optional fence 回到 State Tracker
```

radeonsi draw 先把 packets 與 BO references 累積在 `gfx_cs`，flush 才以 reentrancy predicate 選擇 deferred 或實際 submission。 `ws->cs_flush` 更新 `last_gfx_fence` 後，optional output reference 把 completion handle 交回 State Tracker

#### Callback contract 相同，resource 與 command submission 不同

Radeonsi 仍以 `pipe_screen`／`pipe_context` base 接收 State Tracker requests，但 resource、draw state 與 command submission 都保存在 driver 私有 containers。 以下程式碼來自 [Mesa: src/gallium/drivers/radeonsi/si_pipe.c:223](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_pipe.c#L223)，用來確認 screen 初始化如何把 context、resource、fence 與 texture factories 接到共同的 Gallium slots

```c
static struct pipe_screen *
radeonsi_screen_create_impl(struct radeon_winsys *ws,
                            const struct pipe_screen_config *config)
{
...
   util_idalloc_mt_init_tc(&sscreen->buffer_ids);

   /* Set functions first. */
   sscreen->b.context_create = si_pipe_create_context;
   sscreen->b.destroy = si_destroy_screen;

   si_init_screen_buffer_functions(sscreen);
   si_init_screen_fence_functions(sscreen);
   si_init_screen_texture_functions(sscreen);

   si_init_screen_get_functions(sscreen);
   si_init_screen_caps(sscreen);
...
}
```

State Tracker 仍在 [Mesa: src/mesa/state_tracker/st_manager.c:1005](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L1005) 呼叫 `context_create`，回傳的 concrete context 由同一個 `st_context::pipe` 欄位持有

si_pipe_create_context 位於 [Mesa: src/gallium/drivers/radeonsi/si_pipe.c:107](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_pipe.c#L107)，它先建立 concrete si_context，再視 context flags 決定是否加上 threaded frontend wrapper。 wrapper 不改變 pipe_context contract，底下的 si_context 仍負責硬體 command stream

以下程式碼來自 [Mesa: src/gallium/drivers/radeonsi/si_pipe.h:282](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_pipe.h#L282)，用來顯示 `si_resource` 內嵌公開 `pipe_resource`，並另存 BO pointer、GPU 位址、alignment、memory domains 與 bind history

```c
struct si_resource {
   struct threaded_resource b;

   /* If we remove this seemingly useless padding, performance in Viewperf2020/catiav5test1
    * decreases by 8%.
    */
   uint32_t _pad;

   /* Winsys objects. */
   struct pb_buffer_lean *buf;
   uint64_t gpu_address;

   /* Resource properties. */
   uint64_t bo_size;
   uint8_t bo_alignment_log2;
   enum radeon_bo_domain domains:8;
   enum radeon_bo_flag flags:16;
   unsigned bind_history; /* bitmask of SI_BIND_xxx_BUFFER */
...
```

threaded_resource 內含 pipe_resource base，讓 State Tracker 與 utility 繼續使用同一 reference、target、format、usage 與 bind 欄位。 pb_buffer_lean pointer、位址、size、alignment 與 domain choice 都是 driver 私有 storage state。 State Tracker 不讀取這些欄位，也不把它們當成 pipe_resource 公開 identity

以下程式碼來自 [Mesa: src/gallium/drivers/radeonsi/si_buffer.c:595](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_buffer.c#L595)，用來顯示 `si_alloc_buffer_struct()` 複製呼叫端的 `pipe_resource` template、將 `reference` 初始化為 1 並寫入 `screen`，再執行 `threaded_resource_init()`。 `buf = NULL`、`bind_history = 0` 與 `L2_cache_dirty = false` 表示 backing 尚未配置

```c
static struct si_resource *si_alloc_buffer_struct(struct pipe_screen *screen,
                                                  const struct pipe_resource *templ,
                                                  bool allow_cpu_storage)
{
   struct si_resource *buf = MALLOC_STRUCT_CL(si_resource);

   buf->b.b = *templ;
   buf->b.b.next = NULL;
   pipe_reference_init(&buf->b.b.reference, 1);
   buf->b.b.screen = screen;

   threaded_resource_init(&buf->b.b, allow_cpu_storage);

   buf->buf = NULL;
   buf->bind_history = 0;
   buf->L2_cache_dirty = false;
   util_range_init(&buf->valid_buffer_range);
   return buf;
}
```

template 仍由呼叫端借出，driver 複製 `pipe_resource` base、初始化 reference 並記住所屬 screen。 `threaded_resource_init` 補上 threaded context 需要的 tracking，`si_resource` 私有欄位則從未配置的 state 開始。 [Mesa: src/gallium/drivers/radeonsi/si_buffer.c:152](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_buffer.c#L152) 的 backing 配置接續這個 resource helper，最後仍以 `pipe_resource` factory contract 回傳 storage

resource_create 在 [Mesa: src/gallium/drivers/radeonsi/si_buffer.c:758](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_buffer.c#L758) 依 target 選 buffer 或 texture 路徑。 最後回傳的仍是 pipe_resource pointer，reference 歸呼叫端所有。 storage backing 與 layout 不同，Gallium factory contract 沒有改變

draw 也維持同一入口。 State Tracker 在 [Mesa: src/mesa/state_tracker/st_draw.c:104](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_draw.c#L104) 進入 cso_draw_vbo，radeonsi 則在 [Mesa: src/gallium/drivers/radeonsi/gfx/si_gfx.h:143](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/gfx/si_gfx.h#L143) 依目前 graphics pipeline state 將 selected 函式寫入 sctx->b.draw_vbo

以下程式碼來自 [Mesa: src/gallium/drivers/radeonsi/si_state_draw.cpp:2572](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_state_draw.cpp#L2572)，用來顯示 selected radeonsi draw 函式在 `si_upload_and_prefetch_VB_descriptors()` 失敗時執行 `DRAW_CLEANUP` 並回傳，成功才由 `si_emit_draw_packets()` 把 borrowed draw inputs 寫進 `gfx_cs`，接著啟動 shader prefetch

```cpp
template <amd_gfx_level GFX_VERSION, si_has_tess HAS_TESS,
          si_has_gs HAS_GS, si_has_ngg NGG,
          si_is_draw_vertex_state IS_DRAW_VERTEX_STATE,
          si_has_sh_pairs_packed HAS_SH_PAIRS_PACKED,
          util_popcnt POPCNT, si_alt_hiz_logic ALT_HIZ_LOGIC>
ALWAYS_INLINE static void
si_draw(struct pipe_context *ctx,
        const struct pipe_draw_info *restrict info,
        unsigned drawid_offset,
        const struct pipe_draw_indirect_info *restrict indirect,
        const struct pipe_draw_start_count_bias *restrict draws,
        unsigned num_draws,
        struct pipe_vertex_state *restrict state,
        uint32_t partial_velem_mask)
{
...
   if (unlikely((!si_upload_and_prefetch_VB_descriptors
                     <GFX_VERSION, HAS_TESS, HAS_GS, NGG, IS_DRAW_VERTEX_STATE, HAS_SH_PAIRS_PACKED, POPCNT>
                     (sctx, state, partial_velem_mask)))) {
      DRAW_CLEANUP;
      return;
   }

   si_emit_draw_packets<GFX_VERSION, HAS_TESS, HAS_GS, NGG, IS_DRAW_VERTEX_STATE,
                        HAS_SH_PAIRS_PACKED, ALT_HIZ_LOGIC>
         (sctx, info, drawid_offset, indirect, draws, num_draws, indexbuf,
          index_size, index_offset, instance_count);
   /* <-- CUs start to get busy here if we waited. */

   /* Start prefetches after the draw has been started. Both will run
    * in parallel, but starting the draw first is more important.
    */
   si_prefetch_shaders<GFX_VERSION, HAS_TESS, HAS_GS, NGG>(sctx);
...
}
```

softpipe 與 llvmpipe 將 draw module output 交給 CPU rasterization stages，radeonsi 的 si_emit_draw_packets 則把這次 draw 表達成 command buffer records。 pipe_draw_info 仍是 borrowed input，bound resources 仍靠 context references 存活，但 driver 還要確保 gfx_cs 在 submission 前保留每個 backing object 的必要使用關係

`draw_vbo` 回傳時，driver 已消費這次 Gallium draw request，並將必要 commands 記錄到 context-owned `gfx_cs`。 硬體 completion 由後續 submission fence 表示。 command buffer space 不足時，[Mesa: src/gallium/drivers/radeonsi/gfx/si_gfx.h:127](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/gfx/si_gfx.h#L127) 可以提早要求 flush，公開 callback shape 維持一致

#### Gallium callback 交出 command submission 的位置

radeonsi 的 `draw_vbo` 已把 draw packets、shader state 與 BO references 累積在 `si_context::gfx_cs`，State Tracker 現在以 `pipe_context::flush` 要求 driver 交出這批 work。 必須讀 callback registration、flush flags 與 fence publication，才能判斷 command buffer 何時轉交 winsys，以及 submission completion reference 如何回到呼叫端

前文 [Mesa: src/mesa/state_tracker/st_cb_flush.c:63](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L63) 的 `st_flush()` 已顯示 State Tracker 會呼叫 `st->pipe->flush`

以下程式碼分別節錄同一個檔案的 [Mesa: src/gallium/drivers/radeonsi/si_fence.c:581](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_fence.c#L581-590) 與 [Mesa: src/gallium/drivers/radeonsi/si_fence.c:591](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_fence.c#L591-600)

`si_init_fence_functions()` 把 `pipe_context::flush` 註冊成 `si_flush_from_st`。 `si_init_screen_fence_functions()` 則安裝 screen fence callbacks，讓後續 submission completion 能透過 `pipe_screen` contract 回到呼叫端：

```c
void si_init_fence_functions(struct si_context *ctx)
{
   ctx->b.flush = si_flush_from_st;
#ifdef HAVE_GFX_COMPUTE
   ctx->b.create_fence_fd = si_create_fence_fd;
   ctx->b.fence_server_sync = si_fence_server_sync;
   ctx->b.fence_server_signal = si_fence_server_signal;
#endif
}

void si_init_screen_fence_functions(struct si_screen *screen)
{
   screen->b.fence_finish = si_fence_finish;
   screen->b.fence_reference = si_fence_reference;
   screen->b.fence_get_fd = si_fence_get_fd;
...
}
```

si_flush_from_st 位於 [Mesa: src/gallium/drivers/radeonsi/si_fence.c:520](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_fence.c#L520)，會把 State Tracker flags 轉給 radeonsi flush orchestration。 OpenGL graphics 路徑最後到達 `si_flush_gfx_cs`，deferred、poll、wait 與 reference 仍由同一 pipe fence contract 表達

以下程式碼來自 [Mesa: src/gallium/drivers/radeonsi/si_gfx_cs.c:194](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/radeonsi/si_gfx_cs.c#L194) 的 `si_flush_gfx_cs()`，用來確認 `ws->cs_flush()` 接收 `gfx_cs` 與 flags、更新 `last_gfx_fence`，並依呼叫端的 output slot 建立 fence reference

```c
void
si_flush_gfx_cs(struct si_context *ctx, unsigned flags,
                struct pipe_fence_handle **fence)
{
...
   uint64_t start_ts = 0, submission_id = 0;
   const bool perfetto = ctx->perfetto_enabled;

   if (unlikely(perfetto)) {
      start_ts = si_ds_begin_submit(&ctx->ds_queue);
      submission_id = ctx->ds_queue.submission_id;
   }

   if (unlikely(ctx->sqtt))
      si_sqtt_describe_flush(ctx);

   /* Flush the CS. */
   ws->cs_flush(cs, flags, &ctx->last_gfx_fence);

   if (unlikely(perfetto))
      si_ds_end_submit(&ctx->ds_queue, start_ts);

   tc_driver_internal_flush_notify(ctx->tc);
   if (fence)
      ws->fence_reference(ws, fence, ctx->last_gfx_fence);

   ctx->num_gfx_cs_flushes++;
...
}
```

`ws->cs_flush` 是 Gallium driver 交給 winsys 的 submission 邊界。 呼叫前，`si_context` 擁有已填入 commands 的 `gfx_cs`，並維護其 referenced resources 與 flush flags。 呼叫後，`ctx->last_gfx_fence` 代表這次 submission。 State Tracker 要求 fence 時，`ws->fence_reference` 會在 output slot 建立另一個 reference

`pipe_context::flush` 保證 commands 已交給下一層。 呼叫端要求 fence 時會另取得可等待的 completion handle。 `st_finish` 隨後透過 `pipe_screen::fence_finish` 等待硬體 execution，普通 flush 則讓 CPU 與硬體工作繼續並行

這裡的 handoff objects 是已填入 commands 的 `gfx_cs`、flush flags 與 `last_gfx_fence`。 winsys 接手底層 submission、GPU 位址 space、firmware queue 與硬體 scheduling

三個 drivers 最後仍能用同一組 ownership 問題對齊。 softpipe flush 回傳 sentinel 時，呼叫端執行緒上的工作已完成。 llvmpipe flush 回傳 `lp_fence` 時，screen-owned workers 可能仍持有 scene。 radeonsi flush 回傳 fence 時，command buffer 已越過 driver submission 呼叫，但硬體工作可能仍在進行。 State Tracker 只依 `pipe_context` 與 `pipe_screen` contract 決定何時持有、等待與釋放 fence

## Loader、DRI 與 libgbm

前面已經追到 Mesa driver 如何接住齒輪的 OpenGL work。 現在將視線拉回使用者看到的 Window。 Driver 需要知道目前的 X11 drawable 對應哪些 buffers； 算完一幀後，presentation 路徑也要將結果交回 Xorg

這項需求讓 Mesa 與 Xorg 必須能雙向交換資訊。 GLX loader 代表視窗系統提供 drawable information 與 buffers，DRI frontend／driver 再透過協商好的介面取得或更新它們。 接下來先看這套介面如何建立，再沿著齒輪 Window 的一次 drawable callback roundtrip，確認兩邊實際交接的 objects

完成目前的 GLX／DRI drawable roundtrip 後，本章後半會將時間拉回 Xorg 啟動階段。 Xorg 透過 Mesa `libgbm`，以 DRM device 配置 screen／front BO。 Mesa GBM backend 依使用條件沿 DRI image 路徑或 dumb-buffer 路徑建立 storage，Xorg 再透過 libdrm 將 BO 接到 DRM／KMS framebuffer。 這條初始化路徑會說明 `gbm_device`、`gbm_bo` 與實際 front BO 如何建立關係

### DRI extension 是雙向 versioned ABI

GLX loader 現在要把 X11 drawable 交給一個可替換的 DRI driver，雙方可能來自不同的 Mesa 建置。 DRI extension 以名稱、版本、callback 方向與私有 object 固定這條 ABI，screen 建立時再依雙方提供的 extension 交集選出可用 callback。 以下從共同 header 與兩類 loader extension 展開，再收於 extension binding

#### 共同 extension header

DRI loader 與 driver 可能來自不同的建置，因此 extension table 不能只靠 C struct 的目前大小協商能力。 以下程式碼來自 [`Mesa: include/GL/internal/dri_interface.h:96`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/include/GL/internal/dri_interface.h#L96)，用來確認共同 header 如何以 `name` 與 `version` 支援 append-only ABI

```c
...
 * loader(s) in lock step.
 *
 * However, we can add entry points to an extension over time as long
 * as we don't break the old ones.  As we add entry points to an
 * extension, we increase the version number.  The corresponding
 * #define can be used to guard code that accesses the new entry
 * points at compile time and the version field in the extension
 * struct can be used at run-time to determine how to use the
 * extension.
 */
struct __DRIextensionRec {
    const char *name;
    int version;
};
...
```

`__DRIextensionRec` 以 `name` 與 `version` 兩個欄位組成共同前綴。 具體 extension struct 把它放在第一個成員，因此 loader 在尚未知道實際型態前，可以先把所有項目當成 `__DRIextension`，讀取共同 header，再依 `name` 轉型。 前綴負責辨識與協商，真正的 callback 參數由各 extension struct 定義

版本值表示提供端至少支援到哪一版。 需求端不能因為兩邊都能看到新版 header，就直接呼叫新版尾端欄位。 執行期載入的另一端可能較舊，所以程式必須同時具備兩層保護。 編譯時先確認原始程式碼能引用該欄位，執行時再檢查 `version`。 `loader_bind_extensions()` 只有在 match 被標成必要項時，才會以 false 回報 extension 缺失或版本不足。 選用 extension 可以保持 NULL pointer，使用該欄位的呼叫端必須另行確保 ABI 前置條件成立

extension 陣列以 NULL pointer 結尾。 提供端公開的是一組具名能力，不保證陣列順序固定。 需求端按名稱搜尋，因此新增一個 extension 不會改變其他 extension 的位置，也不要求 loader 與 driver 同步擴充相同的 enum

```callgraph
Mesa DRI extension negotiation
=================================================
[Mesa: src/gallium/frontends/dri/dri_util.c:99] driCreateNewScreen3(..., loader_extensions, ...)
  │
  ├─ `screen = CALLOC_STRUCT(dri_screen)` 失敗：`return NULL`
  └─ [Mesa: src/gallium/frontends/dri/dri_util.c:111] setupLoaderExtensions(screen, loader_extensions)
       ↓
[Mesa: src/gallium/frontends/dri/dri_util.c:77] setupLoaderExtensions(screen, extensions)
  │
  │  // 每個 match 指定 extension name、最低 version 與 struct 欄位 offset
  │  matches[] = { __DRI_IMAGE_LOADER, __DRI_SWRAST_LOADER, ... };
  ↓
[Mesa: src/loader/loader.c:814] loader_bind_extensions(data, matches, num_matches, extensions)
  │
  ├─ 逐一比對 `extensions[i]->name` 與 `extensions[i]->version`
  │    └─ 若名稱相同且版本足夠
  │         └─ `*field = extensions[i]`
  │              // callback table 寫入 `dri_screen` 對應欄位
  │
  ├─ 若找不到且 `match->optional == true`
  │    └─ 記錄偵錯訊息，繼續協商其他 extension
  │
  └─ 若找不到且 `match->optional == false`
       └─ `ret = false`
            // 共用 binder 會回報必要 ABI 缺失。 本次 matches 全為 optional 且呼叫端不讀 ret
            // 最終結果：`screen` 持有協商成功的 callbacks，缺少的 optional 欄位保持 NULL
```

這份 ABI 也說明了 ownership。 extension table 通常是靜態常數，接收端只保存 pointer，不負責釋放。 表內 callback 取得的 `loaderPrivate`、`__DRIscreen` 或 `__DRIdrawable` 則各有自己的生命週期，不能因為 extension table 長期存在，就推論其中傳入的 drawable 也會永久有效

#### Image loader 與 swrast loader

client-side 的軟體 rendering 需要從 loader 取得 drawable 幾何，並把 CPU renderer 完成的 pixels 交回原生 drawable。 以下程式碼來自 [`Mesa: include/GL/internal/dri_interface.h:561`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/include/GL/internal/dri_interface.h#L561)，用來確認 `__DRIswrastLoaderExtensionRec` 的共同 header、drawable query 與 pixel-delivery callbacks

```c
/**
 * SWRast Loader extension.
 *
 * Version 1 is advertised by the X server.
 */
#define __DRI_SWRAST_LOADER "DRI_SWRastLoader"
#define __DRI_SWRAST_LOADER_VERSION 6
struct __DRIswrastLoaderExtensionRec {
    __DRIextension base;

    /*
     * Drawable position and size
     */
    void (*getDrawableInfo)(__DRIdrawable *drawable,
			    int *x, int *y, int *width, int *height,
			    void *loaderPrivate);

    /**
     * Put image to drawable
     */
    void (*putImage)(__DRIdrawable *drawable, int op,
		     int x, int y, int width, int height,
		     char *data, void *loaderPrivate);
    ...
```

`getDrawableInfo` 讓軟體 frontend 在配置 attachment 前取得 X drawable 的位置與大小。 `putImage` 的 `data` 是 CPU 可讀的 pixel data，`op` 區分 draw、clear 與 swap 等操作。 這裡沒有 `pipe_resource`、dma-buf fd 或 kernel BO handle，因為 extension 位於 GLX loader 與 DRI 軟體 frontend 之間，底層軟體 driver 的 storage 尚未跨成 X server object

新版 swrast extension 在尾端加入 `putImage2`、SHM 變體與更多 stride 資訊。 舊 loader 只提供 version 1 的前綴時，driver 仍能使用 `getDrawableInfo`、`putImage` 與 `getImage`。 只有確認 version 與函式指標後，才可選擇新版 callback。 這正是 append-only 規則帶來的相容性

硬體 DRI3 路徑不能自行假設 drawable 一定具有哪些 attachments，而要先向掌握原生 state 的 loader 提出需求。 以下程式碼來自 [`Mesa: include/GL/internal/dri_interface.h:2053`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/include/GL/internal/dri_interface.h#L2053)，用來確認 `getBuffers` 如何分開表達 requested buffer mask 與實際回傳的 image list

```c
struct __DRIimageList {
   uint32_t image_mask;
   __DRIimage *back;
   __DRIimage *front;
};

#define __DRI_IMAGE_LOADER "DRI_IMAGE_LOADER"
#define __DRI_IMAGE_LOADER_VERSION 4

struct __DRIimageLoaderExtensionRec {
    __DRIextension base;

   ...

   int (*getBuffers)(__DRIdrawable *driDrawable,
                     unsigned int format,
                     uint32_t *stamp,
                     void *loaderPrivate,
                     uint32_t buffer_mask,
                     struct __DRIimageList *buffers);
   ...
```

`buffer_mask` 是輸入需求，`image_mask` 是實際回傳集合。 兩者必須分開，因為 loader 可能在更新 drawable、配置 buffer 或匯入 Pixmap 時失敗。 `format` 使用 DRI image format，讓 loader 知道 driver 需要怎樣的 color storage。 `stamp` 連接 drawable invalidation，loader 在原生 buffer 組合改變時更新它，DRI frontend 才知道既有 attachment 需要重新驗證

`__DRIimage` 不是 GL texture name。 它是 DRI image integration object，可包裝由 loader 配置或匯入的 storage。 DRI frontend 後續才把它轉成 `pipe_resource`，State Tracker 再把該 resource 接到 winsys framebuffer。 swrast 的 `data` 更只是用於單次 pixel 存取的 pointer，不具有可跨行程使用的 image identity

兩組 loader extension 的 callback 方向相同，都是由 DRI frontend 呼叫 loader。 差異落在交接 object。 image loader 交出可保留 reference 的 image object，軟體 loader 的 `putImage*` 則消費某次 pixel range。 前者適合在多次 draw 之間重用 buffer，後者必須遵守每次呼叫的座標、尺寸與 stride

```callgraph
Mesa DRI drawable loader callbacks
=================================================
[Mesa: src/gallium/frontends/dri/dri2.c:111] dri_image_drawable_get_buffers(drawable, images, statts, count)
  │
  │  // 將 State Tracker attachment 轉成 DRI image buffer mask
  │  switch (statts[i]) { FRONT_LEFT; BACK_LEFT; }
  │
  ├─ 若 `ST_ATTACHMENT_FRONT_LEFT`
  │    └─ `buffer_mask |= __DRI_IMAGE_BUFFER_FRONT`
  │
  └─ 若 `ST_ATTACHMENT_BACK_LEFT`
       └─ `buffer_mask |= __DRI_IMAGE_BUFFER_BACK`
  ↓
[Mesa: src/gallium/frontends/dri/loader_dri3_helper.c:2191] loader_dri3_get_buffers(..., buffer_mask, images)
  │
  ├─ 若 `dri3_update_drawable(draw)` 失敗
  │    └─ `return false`
  │
  └─ 成功時配置或重用 front／back image
       └─ `images->image_mask` 與 `images->front/back` 回到 DRI frontend

Mesa 軟體 drawable callbacks
=================================================
軟體 DRI frontend
  │
  ├─ drawable 驗證 stage
  │    ↓
  │  [Mesa: src/gallium/frontends/dri/drisw.c:54] get_drawable_info(drawable, &x, &y, &w, &h)
  │    └─ `loader->getDrawableInfo(..., drawable->loaderPrivate)`
  │         // `loaderPrivate` 讓 GLX loader 找回原生 X drawable
  │
  └─ 後續軟體 swap 階段
       ↓
     [Mesa: src/gallium/frontends/dri/drisw.c:63] put_image(drawable, data, width, height)
       └─ `loader->putImage(..., data, drawable->loaderPrivate)`
            // 最終結果：CPU pixels 交回 GLX 擁有的 drawable 邊界
```

因此，看到 `getBuffers` 時要追蹤 image identity、mask 與 stamp。 看到 `putImage` 時則要追蹤 CPU pointer、範圍與呈現動作。 把兩者都簡化成「取得 framebuffer」會遺失 ownership 與資料移動方向，也無法解釋 DRI3 為何能保留 back image，而 drisw 需要在 swap 時把 pixels 交回 X loader

#### Extension binding

Screen 建立收到 loader extension 陣列後，必須依名稱、最低版本與 optional policy 將每個 table 放進 `dri_screen` 的正確欄位。 以下程式碼來自 [`Mesa: src/loader/loader.c:814`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/loader/loader.c#L814)，用來追蹤 `loader_bind_extensions()` 如何完成搜尋、版本檢查與欄位寫入

```c
bool
loader_bind_extensions(void *data,
                       const struct dri_extension_match *matches, size_t num_matches,
                       const __DRIextension **extensions)
{
   bool ret = true;

   for (size_t j = 0; j < num_matches; j++) {
      const struct dri_extension_match *match = &matches[j];
      const __DRIextension **field = (const __DRIextension **)((char *)data + matches[j].offset);
      for (size_t i = 0; extensions[i]; i++) {
         if (strcmp(extensions[i]->name, match->name) == 0 &&
             extensions[i]->version >= match->version) {
            *field = extensions[i];
            break;
         }
      }

      if (!*field) {
         log_(match->optional ? _LOADER_DEBUG : _LOADER_FATAL, "did not find extension %s version %d\n",
               match->name, match->version);
         if (!match->optional)
            ret = false;
         continue;
      }
      ...
   }
...
}
```

`matches[j].offset` 表示目標 struct 中待寫入欄位的位移，與 extension 陣列索引無關。 呼叫端用 `offsetof()` 建立描述表。 找到名稱與最低版本後，binder 保存提供端的靜態 extension pointer。 找不到時，選用項只記錄偵錯訊息，必要項會讓整體結果成為 false

這裡的最低版本比較使用 `extensions[i]->version >= match->version`。 提供端比需求端新並不構成錯誤，只要舊前綴仍維持原樣。 相反地，名稱相符但版本不足時不能勉強轉型，因為需求端即將呼叫的欄位可能根本不在提供端的 struct 中

Gallium DRI frontend 還要宣告自己會接收哪些視窗系統 loader tables，以及每個 table 要寫到哪個 `dri_screen` 欄位。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri_util.c:77`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_util.c#L77)，用來確認 `setupLoaderExtensions()` 的 match table 如何指定最低版本、欄位 offset 與 optional policy

```c
static void
setupLoaderExtensions(struct dri_screen *screen,
                      const __DRIextension **extensions)
{
   static const struct dri_extension_match matches[] = {
       {__DRI_IMAGE_LOOKUP, 1, offsetof(struct dri_screen, dri2.image), true},
       {__DRI_SWRAST_LOADER, 1, offsetof(struct dri_screen, swrast_loader), true},
       {__DRI_IMAGE_LOADER, 1, offsetof(struct dri_screen, image.loader), true},
       {__DRI_MUTABLE_RENDER_BUFFER_LOADER, 1, offsetof(struct dri_screen, mutableRenderBuffer.loader), true},
       {__DRI_KOPPER_LOADER, 1, offsetof(struct dri_screen, kopper_loader), true},
   };
   loader_bind_extensions(screen, matches, ARRAY_SIZE(matches), extensions);
}
```

`matches` 中的數值是 binder 接受相符 extension 的最低版本，不是 header 宣告的最高版本。 screen 保存的實際 `base.version` 仍可能更高，後續 helper 再依較新版 callback 做最佳化。 `setupLoaderExtensions()` 在 `driCreateNewScreen3()` 配置好 `dri_screen` 後立即執行，早於硬體／軟體 screen 分流

`dri_screen` 同時保存借用與自有 state。 loader 提供的 extension table pointer 與 `loaderPrivate` 都只是借用。 `pipe_screen`、pipe-loader device、option cache 與 `dri_screen` object 才由 DRI screen 負責回收。 `dri_destroy_screen()` 不會釋放借來的 table 或 loader 私有 object

但 optional binding 不會保證 pointer 存在，例如 `drisw_init_screen()` 會直接讀取 `screen->swrast_loader->base.version`。 呼叫端若沒有滿足前置條件，固定實作不會先建立乾淨的失敗分支

```callgraph
Mesa Gallium DRI frontend
=================================================
[Mesa: src/gallium/frontends/dri/dri_util.c:99] driCreateNewScreen3(scrn, fd, loader_extensions, type, ...)
  │
  ├─ `screen = CALLOC_STRUCT(dri_screen)` 失敗
  │    └─ `return NULL`
  │
  ├─ [Mesa: src/gallium/frontends/dri/dri_util.c:77] setupLoaderExtensions(screen, loader_extensions)
  │    └─ 借用 image／swrast loader extension table pointer
  │
  ├─ [Mesa: src/gallium/frontends/dri/dri_util.c:113] `screen->loaderPrivate = data`
  │    └─ 保存 loader-owned 私有 pointer，不取得 ownership
  │
  ├─ `type == DRI_SCREEN_DRI3`
  │    └─ [Mesa: src/gallium/frontends/dri/dri2.c:1748] dri2_init_screen(screen, ...)
  │
  └─ `type == DRI_SCREEN_SWRAST`
       └─ [Mesa: src/gallium/frontends/dri/drisw.c:597] drisw_init_screen(screen, ...)
  ↓
  │
  ├─ 若 `pscreen == NULL`
  │    └─ [Mesa: src/gallium/frontends/dri/dri_screen.c:593] `dri_destroy_screen(screen); return NULL`
  │         // 只回收 DRI-screen-owned state。 借用的 table 與 loaderPrivate 不在回收範圍
  │
  └─ 成功
       └─ `*driver_configs = dri_init_screen(screen, pscreen, has_multibuffer)`
            // DRI screen 取得可建立 context 與 resource 的 `pipe_screen`
```

Extension binding 完成後，`dri_screen` 已借用 callback table 與 loader 私有 pointer。 screen 初始化接著產生共同的 `pipe_screen`，context 與 drawable image 再由各自的 API 生命週期建立

### GLX loader callback roundtrip

Extension binding 完成後，DRI frontend 拿到的仍是 callback table 與 `loaderPrivate`，而不是直接可存取的 X drawable storage。 當 State Tracker 準備驗證 drawable 或軟體 renderer 準備寫回 pixels 時，它必須透過這組 callback 回到 GLX loader。 追這個 roundtrip 可以確定 drawable identity、attachment 與 pixel data 在交界處由誰擁有，也為下一節的 `pipe_screen` 建立路徑提供 loader 側輸入

#### GLX 實作 loader callback table

GLX loader 必須把 X drawable 接到 Mesa DRI drawable，又不能讓 Gallium DRI frontend 依賴 Xlib、XCB 或 Present 型態。 以下程式碼來自 [`Mesa: src/glx/dri3_glx.c:342`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri3_glx.c#L342)，用來確認 DRI3 GLX 如何用靜態 image-loader table 隱藏原生 drawable operations

```c
/* The image loader extension record for DRI3
 */
static const __DRIimageLoaderExtension imageLoaderExtension = {
   .base = { __DRI_IMAGE_LOADER, 3 },

   .getBuffers          = loader_dri3_get_buffers,
   .flushFrontBuffer    = dri3_flush_front_buffer,
   .flushSwapBuffers    = dri3_flush_swap_buffers,
};

static const __DRIextension *loader_extensions[] = {
   &imageLoaderExtension.base,
   NULL
};
```

DRI3 table 宣告 version 3，表示這個提供端願意讓 driver 使用到該版定義的尾端欄位。 `getBuffers` 是 drawable 驗證的主要反向入口。 `flushFrontBuffer` 與 `flushSwapBuffers` 則處理視窗系統 buffer 交付前的 flush 邊界。 表內沒有建立 context 的函式，因為 context 是 driver 依 DRI screen 建立，這張 table 只補足 loader 掌握的 drawable 能力

`loader_extensions` 在這裡包含 image loader 與終止用的 NULL pointer，傳遞方向是從 GLX loader 到 DRI frontend。 Driver 提供給 loader 的 screen extensions 則由另一個陣列傳遞

軟體 GLX loader 使用相同的 extension header，但 callbacks 直接連到 X drawable 的幾何與 image operations。 以下程式碼來自 [`Mesa: src/glx/drisw_glx.c:366`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/drisw_glx.c#L366)，用來確認 version 6 的 swrast table 如何同時公布一般與 shared-memory pixel transport

```c
static const __DRIswrastLoaderExtension swrastLoaderExtension_shm = {
   .base = {__DRI_SWRAST_LOADER, 6 },

   .getDrawableInfo     = swrastGetDrawableInfo,
   .putImage            = swrastPutImage,
   .getImage            = swrastGetImage,
   .putImage2           = swrastPutImage2,
   .getImage2           = swrastGetImage2,
   .putImageShm         = swrastPutImageShm,
   .getImageShm         = swrastGetImageShm,
   .putImageShm2        = swrastPutImageShm2,
   .getImageShm2        = swrastGetImageShm2,
};
```

`getDrawableInfo` 與 `getImage*` 是 loader 向 X drawable 讀取 state 或內容的邊界，`putImage*` 則把 client 行程中的軟體 rendering 結果交回 X drawable。 SHM 版本減少一般 image request 需要攜帶的 pixel data，但不改變 ownership。 X server 仍管理目標 Drawable，Mesa 軟體 resource 仍位於 client renderer 一側

DRI 軟體 winsys 建立 display target 時，會根據 loader 是否提供 SHM callback 選擇實際 backing。 以下程式碼來自 [`Mesa: src/gallium/winsys/sw/dri/dri_sw_winsys.c:130`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/sw/dri/dri_sw_winsys.c#L130-179) 的 `dri_sw_displaytarget_create()`，用來顯示可用 `put_image_shm` 時先呼叫 `alloc_shm()`，否則回退到 `align_malloc()`：

```c
static struct sw_displaytarget *
dri_sw_displaytarget_create(struct sw_winsys *winsys,
                            unsigned tex_usage,
                            enum pipe_format format,
                            unsigned width, unsigned height,
                            unsigned alignment,
                            const void *front_private,
                            unsigned *stride)
{
   UNUSED struct dri_sw_winsys *ws = dri_sw_winsys(winsys);
   struct dri_sw_displaytarget *dri_sw_dt;
   unsigned nblocksy, size, format_stride;

   dri_sw_dt = CALLOC_STRUCT(dri_sw_displaytarget);
   if (!dri_sw_dt)
      goto no_dt;

   ...
   format_stride = util_format_get_stride(format, width);
   dri_sw_dt->stride = align(format_stride, alignment);

   nblocksy = util_format_get_nblocksy(format, height);
   size = dri_sw_dt->stride * nblocksy;
   dri_sw_dt->size = size;

   dri_sw_dt->shmid = -1;
   dri_sw_dt->fd = -1;

#ifdef HAVE_SYS_SHM_H
   if (ws->lf->put_image_shm)
      dri_sw_dt->data = alloc_shm(dri_sw_dt, size);
#endif

   if (!dri_sw_dt->data)
      dri_sw_dt->data = align_malloc(size, alignment);

   if (!dri_sw_dt->data)
      goto no_data;

   *stride = dri_sw_dt->stride;
   return (struct sw_displaytarget *)dri_sw_dt;
   ...
}
```

SHM 分支讓 `dri_sw_displaytarget::data` 指向 attach 後的 SysV segment，softpipe 直接在這個位址產生 pixels。 後面的 `dri_sw_displaytarget_display()` 看見有效 `shmid` 時，會把同一個 segment identity、offset 與 dirty 矩形傳給 `put_image_shm` callback

Heap fallback 才經一般 `put_image`／`put_image2` callback 交付 bytes

因此「renderer storage」與「XShm handoff reference」在 SHM 分支可以指向同一份 client-side storage，不能固定畫成兩份 pixel 副本

callback table 採靜態儲存期，DRI screen 保存的是借用的 table pointer。 table 本身不保存某個 `loaderPrivate` instance。 每次呼叫都會帶入當下的 `__DRIdrawable` 與其私有 pointer，因此同一張 table 能服務同一 screen 上的多個 Window、Pixmap 或 pbuffer

進入 pixel handoff 以前，`drisw` 還要先確認這一幀的 rendering 已經完成。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/drisw.c:225`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/drisw.c#L225-272) 的 `drisw_swap_buffers_with_damage()`，用來顯示 glthread、State Tracker flush、Gallium fence 與 front-buffer handoff 的先後順序：

```c
static void
drisw_swap_buffers_with_damage(struct dri_drawable *drawable,
                               int nrects, const int *rects)
{
   ...
   struct dri_context *ctx = dri_get_current();
   struct pipe_resource *ptex;

   if (!ctx)
      return;

   _mesa_glthread_finish(ctx->st->ctx);

   ptex = drawable->textures[ST_ATTACHMENT_BACK_LEFT];

   if (ptex) {
      struct pipe_fence_handle *fence = NULL;
      ...

      st_context_flush(ctx->st, ST_FLUSH_FRONT, &fence, NULL, NULL);
      ...

      screen->base.screen->fence_finish(screen->base.screen,
                                        ctx->st->pipe, fence,
                                        OS_TIMEOUT_INFINITE);
      screen->base.screen->fence_reference(screen->base.screen,
                                           &fence, NULL);

      drisw_copy_to_front(ctx->st->pipe, drawable, ptex, 0, NULL);
      ...
   }
}
```

`_mesa_glthread_finish()` 先讓同一個 context 排入 glthread 的工作完成，避免不同 threads 同時使用 `pipe_context`。 `st_context_flush()` 再取得代表 driver work 的 fence，`fence_finish(..., OS_TIMEOUT_INFINITE)` 等到這份 work 完成，並由 `fence_reference(..., NULL)` 解除 reference。 完成上述同步後，`drisw_copy_to_front()` 才會開始把算好的 pixels 交給前端顯示路徑

```callgraph
Mesa GLX loader
=================================================
[Mesa: src/glx/dri3_glx.c:342] imageLoaderExtension
  │
  ├─ `.getBuffers = loader_dri3_get_buffers`
  ├─ `.flushFrontBuffer = dri3_flush_front_buffer`
  └─ `.flushSwapBuffers = dri3_flush_swap_buffers`
       // 硬體 direct-rendering 路徑以 `__DRIimage` 傳遞 drawable attachments
  ↓
[Mesa: src/gallium/frontends/dri/dri2.c:111]
bool dri_image_drawable_get_buffers(
    struct dri_drawable *drawable,
    struct __DRIimageList *images,
    const enum st_attachment_type *statts,
    unsigned statts_count)
  │
  ├─ 遍歷 statts，依 front／back attachments 組成 buffer_mask
  └─ image.loader->getBuffers(drawable, color_format,
         (uint32_t *)&drawable->base.stamp,
         drawable->loaderPrivate, buffer_mask, images)
       // 組成 mask 後會呼叫 loader callback
  ↓
DRI frontend 取得 `__DRIimageList`

Mesa GLX 軟體 loader
=================================================
[Mesa: src/glx/drisw_glx.c:366] swrastLoaderExtension_shm
  │
  ├─ `.getDrawableInfo = swrastGetDrawableInfo`
  ├─ `.putImage = swrastPutImage`
  ├─ `.putImage2 = swrastPutImage2`
  ├─ `.putImageShm = swrastPutImageShm`
  └─ `.putImageShm2 = swrastPutImageShm2`
       // version 6 table 將一般、SHM 與 SHM2 callback 分開註冊
  ↓
Gallium DRI 軟體 callback consumers
  ├─ 驗證路徑
  │    ↓
  │  [Mesa: src/gallium/frontends/dri/drisw.c:54]
  │  static inline void
  │  get_drawable_info(struct dri_drawable *drawable,
  │                    int *x, int *y, int *w, int *h)
  │    └─ loader->getDrawableInfo(drawable, x, y, w, h,
  │                                  drawable->loaderPrivate)
  │
  └─ swap／pixel handoff 路徑
       ↓
     [Mesa: src/gallium/frontends/dri/drisw.c:225]
     static void
     drisw_swap_buffers_with_damage(struct dri_drawable *drawable,
                                    int nrects, const int *rects)
       ↓
     [Mesa: src/gallium/frontends/dri/drisw.c:210]
     static inline void
     drisw_copy_to_front(struct pipe_context *pipe,
                         struct dri_drawable *drawable,
                         struct pipe_resource *ptex,
                         int nboxes, struct pipe_box *boxes)
       ↓
     [Mesa: src/gallium/frontends/dri/drisw.c:190]
     static inline void
     drisw_present_texture(struct pipe_context *pipe,
                           struct dri_drawable *drawable,
                           struct pipe_resource *ptex,
                           unsigned nrects, struct pipe_box *sub_box)
       ↓
     [Mesa: src/gallium/include/pipe/p_screen.h:382]
     void (*pipe_screen::flush_frontbuffer)(
         struct pipe_screen *screen, struct pipe_context *ctx,
         struct pipe_resource *resource, unsigned level, unsigned layer,
         void *winsys_drawable_handle, unsigned nboxes,
         struct pipe_box *subbox)
       ↓
     軟體 driver `flush_frontbuffer` callback
       ├─ [Mesa: src/gallium/drivers/llvmpipe/lp_screen.c:766]
       │  static void
       │  llvmpipe_flush_frontbuffer(struct pipe_screen *_screen,
       │                               struct pipe_context *_pipe,
       │                               struct pipe_resource *resource,
       │                               unsigned level, unsigned layer,
       │                               void *context_private,
       │                               unsigned nboxes,
       │                               struct pipe_box *sub_box)
       │
       └─ [Mesa: src/gallium/drivers/softpipe/sp_screen.c:406]
          static void
          softpipe_flush_frontbuffer(struct pipe_screen *_screen,
                                     struct pipe_context *pipe,
                                     struct pipe_resource *resource,
                                     unsigned level, unsigned layer,
                                     void *context_private,
                                     unsigned nboxes,
                                     struct pipe_box *sub_box)
            // 兩者都呼叫 winsys->displaytarget_display(...)
       ↓
     [Mesa: src/gallium/winsys/sw/dri/dri_sw_winsys.c:349]
     static void
     dri_sw_displaytarget_display(struct sw_winsys *ws,
                                  struct sw_displaytarget *dt,
                                  void *context_private,
                                  unsigned nboxes,
                                  struct pipe_box *box)
       │
       ├─ nboxes == 0：交付整張 displaytarget
       │    ├─ SHM backing：lf->put_image_shm(...)
       │    └─ heap backing：lf->put_image(...)
       │
       └─ nboxes > 0：逐個交付 dirty boxes
            ├─ SHM backing：lf->put_image_shm(...)
            └─ heap backing：lf->put_image2(...)
       ↓
     Gallium DRI 軟體 put-image callbacks
       ├─ [Mesa: src/gallium/frontends/dri/drisw.c:165]
       │  static void drisw_put_image(struct dri_drawable *drawable,
       │                               void *data,
       │                               unsigned width, unsigned height)
       ├─ [Mesa: src/gallium/frontends/dri/drisw.c:172]
       │  static void drisw_put_image2(struct dri_drawable *drawable,
       │                                void *data, int x, int y,
       │                                unsigned width, unsigned height,
       │                                unsigned stride)
       └─ [Mesa: src/gallium/frontends/dri/drisw.c:180]
          static inline void drisw_put_image_shm(
              struct dri_drawable *drawable, int shmid, char *shmaddr,
              unsigned offset, unsigned offset_x, int x, int y,
              unsigned width, unsigned height, unsigned stride)
       ↓
     Gallium DRI selector helpers
       ├─ [Mesa: src/gallium/frontends/dri/drisw.c:63]
       │  static inline void
       │  put_image(struct dri_drawable *drawable, void *data,
       │            unsigned width, unsigned height)
       │    └─ loader->putImage(drawable, ..., data,
       │                              drawable->loaderPrivate)
       │
       ├─ [Mesa: src/gallium/frontends/dri/drisw.c:73]
       │  static inline void
       │  put_image2(struct dri_drawable *drawable, void *data,
       │             int x, int y, unsigned width, unsigned height,
       │             unsigned stride)
       │    └─ loader->putImage2(drawable, ..., data,
       │                               drawable->loaderPrivate)
       │
       └─ [Mesa: src/gallium/frontends/dri/drisw.c:84]
          static inline void
          put_image_shm(struct dri_drawable *drawable,
                        int shmid, char *shmaddr,
                        unsigned offset, unsigned offset_x,
                        int x, int y, unsigned width, unsigned height,
                        unsigned stride)
            ├─ version > 4 且 putImageShm2 存在：
            │    └─ loader->putImageShm2(..., loaderPrivate)
            └─ 舊版或沒有 putImageShm2：
                 └─ loader->putImageShm(..., loaderPrivate)
       ↓
     Mesa GLX put-image callbacks
       ├─ 整張 heap image：
       │    ↓
       │  [Mesa: src/glx/drisw_glx.c:279]
       │  static void swrastPutImage(
       │      struct dri_drawable *draw, int op, int x, int y,
       │      int w, int h, char *data, void *loaderPrivate)
       │
       ├─ heap image dirty box：
       │    ↓
       │  [Mesa: src/glx/drisw_glx.c:267]
       │  static void swrastPutImage2(
       │      struct dri_drawable *draw, int op, int x, int y,
       │      int w, int h, int stride, char *data,
       │      void *loaderPrivate)
       │
       └─ SHM-backed image：
            ├─ version 6 table 固定選擇 putImageShm2
            │    ↓
            │  [Mesa: src/glx/drisw_glx.c:250]
            │  static void swrastPutImageShm2(
            │      struct dri_drawable *draw, int op, int x, int y,
            │      int w, int h, int stride, int shmid, char *shmaddr,
            │      unsigned offset, void *loaderPrivate)
            │
            └─ 舊版 loader fallback
                 ↓
               [Mesa: src/glx/drisw_glx.c:234]
               static void swrastPutImageShm(
                   struct dri_drawable *draw, int op, int x, int y,
                   int w, int h, int stride, int shmid, char *shmaddr,
                   unsigned offset, void *loaderPrivate)
                 // 四個 callbacks 最後都進入共同 helper
       ↓
     [Mesa: src/glx/drisw_glx.c:199]
     static void swrastXPutImage(
         struct dri_drawable *draw, int op, int srcx, int srcy,
         int x, int y, int w, int h, int stride,
         int shmid, char *data, void *loaderPrivate)
       ├─ pdp = loaderPrivate
       ├─ drawable = pdp->base.xDrawable
       ├─ gc = pdp->gc
       ├─ SHM-backed XImage：
       │    ↓
       │  [libXext API: include/X11/extensions/XShm.h:88]
       │  Bool XShmPutImage(Display *dpy, Drawable d, GC gc,
       │                    XImage *image, int src_x, int src_y,
       │                    int dst_x, int dst_y,
       │                    unsigned int src_width,
       │                    unsigned int src_height, Bool send_event)
       │
       └─ 一般 drawable：
            ↓
          [libX11: src/PutImage.c:934]
          int XPutImage(Display *dpy, Drawable d, GC gc, XImage *image,
                        int req_xoffset, int req_yoffset, int x, int y,
                        unsigned int req_width,
                        unsigned int req_height)
            // 第一篇在 Mesa 呼叫 Xlib／Xext API 的位置停下
```

這個分流發生在 DRI screen type 確定之後。 後續 OpenGL State Tracker 面對的仍是 winsys framebuffer 與 Gallium resource，不會直接呼叫 Xlib。 只有 DRI frontend 需要更新 attachment 或交付軟體 rendering 結果時，控制流才沿 loader table 回到 GLX

`loaderPrivate` 能帶回正確的 X11 drawable，是因為 drawable 建立時就保存了兩個不同 namespace 的 identity。 以下程式碼來自 [`Mesa: src/glx/drisw_glx.c:485`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/drisw_glx.c#L485)，用來顯示 `driswCreateDrawable()` 保存 application Window 的 `xDrawable`、GLXDrawable、screen 與 GC，再把 `pdp` 傳成 DRI drawable 的 loader 私有 pointer

```c
static __GLXDRIdrawable *
driswCreateDrawable(struct glx_screen *base, XID xDrawable,
                    GLXDrawable drawable, int type,
                    struct glx_config *modes)
{
   struct drisw_drawable *pdp;
   ...

   pdp = calloc(1, sizeof(*pdp));
   if (!pdp)
      return NULL;

   pdp->base.xDrawable = xDrawable;
   pdp->base.drawable = drawable;
   pdp->base.psc = &psc->base;
   pdp->config = modes;
   pdp->gc = XCreateGC(dpy, xDrawable, 0, NULL);
   ...

   pdp->base.dri_drawable =
      dri_create_drawable(psc->base.frontend_screen, config->driConfig,
                          !(type & GLX_WINDOW_BIT), pdp);
   ...
   return &pdp->base;
}
```

Swap callback 必須從 loader 私有 GLX drawable 找回 X server 已知的 Window XID、X image 與 GC。 以下程式碼來自 [`Mesa: src/glx/drisw_glx.c:199`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/drisw_glx.c#L199)，用來追蹤軟體 loader 如何選擇 `XShmPutImage()` 或 `XPutImage()` 完成 pixel delivery

```c
static void
swrastXPutImage(struct dri_drawable *draw, int op,
                int srcx, int srcy, int x, int y,
                int w, int h, int stride,
                int shmid, char *data, void *loaderPrivate)
{
   struct drisw_drawable *pdp = loaderPrivate;
   __GLXDRIdrawable *pdraw = &pdp->base;
   Display *dpy = pdraw->psc->dpy;
   Drawable drawable;
   XImage *ximage;
   GC gc = pdp->gc;
   ...

   drawable = pdraw->xDrawable;
   ximage = pdp->ximage;
   ximage->bytes_per_line =
      stride ? stride : bytes_per_line(w * ximage->bits_per_pixel, 32);
   ximage->data = data;
   ...

   if (pdp->shminfo.shmid >= 0) {
      XShmPutImage(dpy, drawable, gc, ximage,
                   srcx, srcy, x, y, w, h, False);
      XSync(dpy, False);
   } else {
      XPutImage(dpy, drawable, gc, ximage,
                srcx, srcy, x, y, w, h);
   }
   ximage->data = NULL;
}
```

這個 helper 沒有把 pixels 交給 `twm`，也沒有把 swap target 改成 `twm` frame Window。 它把同一個 application Window XID、GC、目標座標與 image data 交給 Xlib／Xext API。 Wire protocol bytes 由 libX11 或 libXext 建立； X server 如何 dispatch request、套用 drawable origin 與 composite clip，屬於本系列 Xorg／GLX／DRI3／Present 篇的 server-side 主線

SHM 與非 SHM 是執行期分支。 `swrastLoaderExtension_shm` 表示 loader 能提供 MIT-SHM callbacks，不代表每一個 drawable 都一定成功使用 shared memory。 無論走哪一支，softpipe 仍負責「怎麼算出 pixels」，drisw 則負責「怎麼把算好的 pixels 交給 X11 drawable」

#### Gallium DRI frontend 反向要求 drawable buffer

State Tracker 驗證 winsys framebuffer 時，Gallium DRI frontend 必須把 attachment requests 轉成 image loader 能理解的 mask 與 color format。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri2.c:111`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri2.c#L111)，用來追蹤 `dri_image_drawable_get_buffers()` 如何建立這份 loader request

```c
bool
dri_image_drawable_get_buffers(struct dri_drawable *drawable,
                               struct __DRIimageList *images,
                               const enum st_attachment_type *statts,
                               unsigned statts_count)
{
   enum pipe_format color_format = PIPE_FORMAT_NONE;
   uint32_t buffer_mask = 0;
   unsigned i;

   for (i = 0; i < statts_count; i++) {
      enum pipe_format pf;
      unsigned bind;

      dri_drawable_get_format(drawable, statts[i], &pf, &bind);
      if (pf == PIPE_FORMAT_NONE)
         continue;

      switch (statts[i]) {
      case ST_ATTACHMENT_FRONT_LEFT:
         buffer_mask |= __DRI_IMAGE_BUFFER_FRONT;
         color_format = pf;
         break;
      case ST_ATTACHMENT_BACK_LEFT:
         buffer_mask |= __DRI_IMAGE_BUFFER_BACK;
         color_format = pf;
         break;
      default:
         break;
      }
   }
   ...
}
```

`statts` 是 State Tracker 的 attachment vocabulary。 這段只把 front-left 與 back-left 納入 image loader mask，其他 attachment 由 DRI frontend 或 driver 依自己的 resource 規則處理。 `dri_drawable_get_format()` 同時取得 `pipe_format` 與 bind requirement，但 callback 傳出的 `format` 只需要 color image format。 mask 為零表示本次沒有可交給 image loader 的 attachment

迴圈完成後，函式把 drawable、format、stamp 位址、loader 私有資料、mask 與輸出 list 一次傳給 `getBuffers`。 `drawable->base.stamp` 的位址讓 loader 記住要更新哪個 stamp。 回傳 false 代表這一輪沒有取得可用 buffer，呼叫端必須保留表示失敗的 state，不能使用未初始化的 image pointer

以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri2.c:152`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri2.c#L152)，用來顯示同一函式最後透過 `drawable->screen->image.loader->getBuffers()` 將 `color_format`、`base.stamp`、`loaderPrivate` 與 `buffer_mask` 送回 GLX loader，並直接回傳 callback 結果

```c
bool
dri_image_drawable_get_buffers(struct dri_drawable *drawable,
                               struct __DRIimageList *images,
                               const enum st_attachment_type *statts,
                               unsigned statts_count)
{
...
    * How do we get here:
    *    dri_set_tex_buffer2 (GLX_EXT_texture_from_pixmap)
    *    st_api_make_current
    *    st_manager_validate_framebuffers (part of st_validate_state)
    */
   return drawable->screen->image.loader->getBuffers(
                                          drawable,
                                          color_format,
                                          (uint32_t *)&drawable->base.stamp,
                                          drawable->loaderPrivate, buffer_mask,
                                          images);
}
```

這裡呈現完整 roundtrip 的中點。 `drawable->screen->image.loader` 指回 GLX 建立的靜態 table，`drawable->loaderPrivate` 則指向這一個 GLX drawable 的私有 state。 DRI frontend 擁有 `dri_drawable`，GLX loader 擁有 buffer pool、XID 與 presentation state，兩者藉由私有 pointer 關聯，沒有互相包含對方的具體 struct

Image loader 收到 request 後，必須避免在失敗路徑留下上一輪的 image pointers，並先更新原生 drawable 與 buffer pool。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/loader_dri3_helper.c:2191`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/loader_dri3_helper.c#L2191)，用來確認 `loader_dri3_get_buffers()` 的 output 初始化、format conversion 與 drawable-update 邊界

```c
int
loader_dri3_get_buffers(struct dri_drawable *driDrawable,
                        unsigned int format,
                        uint32_t *stamp,
                        void *loaderPrivate,
                        uint32_t buffer_mask,
                        struct __DRIimageList *buffers)
{
   struct loader_dri3_drawable *draw = loaderPrivate;
   struct loader_dri3_buffer   *front, *back;
   int fourcc = loader_pipe_format_to_fourcc(format);
   int buf_id;

   buffers->image_mask = 0;
   buffers->front = NULL;
   buffers->back = NULL;

   if (!dri3_update_drawable(draw))
      return false;

   dri3_update_max_num_back(draw);
   ...
}
```

`format` 先轉成 FourCC，因為 GLX DRI3 buffer pool 與 X Pixmap 交換需要原生 image format。 `dri3_update_drawable()` 可以發現尺寸或 drawable state 改變，`dri3_update_max_num_back()` 則依交換模式調整 back-buffer 數量。 這些都是 loader 責任，Gallium driver 不應固定 Present queue 深度

成功回傳後，frontend 取得的只是 image reference。 把 image 匯入成 `pipe_resource`、建立 surface 並綁到 framebuffer，仍在 DRI frontend 與 State Tracker 的後續步驟。 presentation 也不在 `getBuffers` 內發生，這個 callback 只確保 draw 所需的 attachment identity 與 current drawable state 一致

```callgraph
Mesa State Tracker
=================================================
[Mesa: src/mesa/state_tracker/st_manager.c:1261] st_manager_validate_framebuffers(st)
  │
  │  // draw／read framebuffer 需要有效的 winsys attachments
  └─ `st_framebuffer_validate(stfb, st)`
  ↓
[Mesa: src/gallium/frontends/dri/dri2.c:111] dri_image_drawable_get_buffers(drawable, images, statts, statts_count)
  │
  ├─ `ST_ATTACHMENT_FRONT_LEFT`
  │    └─ `buffer_mask |= __DRI_IMAGE_BUFFER_FRONT`
  └─ `ST_ATTACHMENT_BACK_LEFT`
       └─ `buffer_mask |= __DRI_IMAGE_BUFFER_BACK`
  ↓
[Mesa: src/gallium/frontends/dri/loader_dri3_helper.c:2191] loader_dri3_get_buffers(..., buffer_mask, buffers)
  │
  ├─ 若 drawable update 失敗
  │    └─ `return false`
  └─ 成功時
       └─ 回傳 `buffers->front/back` 與實際 `image_mask`
            // State Tracker 可將 DRI image 參照轉成 framebuffer resource
```

roundtrip 完成後，控制流回到 DRI frontend。 GLX loader 沒有取得 OpenGL context state，driver 也沒有接管 X drawable 的 presentation policy。 雙向 ABI 只讓各自的 owner 在需要時回答自己掌握的資訊

#### 軟體 drawable 驗證

client-side 軟體 renderer 也要在 draw／swap 前取得 X11 Window 幾何，並在 presentation 時把 CPU image 交回 loader。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/drisw.c:54`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/drisw.c#L54)，用來確認 `get_drawable_info()` 與 `put_image()` 如何共用 swrast loader table 與 `loaderPrivate`

```c
static inline void
get_drawable_info(struct dri_drawable *drawable, int *x, int *y, int *w, int *h)
{
   const __DRIswrastLoaderExtension *loader = drawable->screen->swrast_loader;

   loader->getDrawableInfo(drawable, x, y, w, h,
                           drawable->loaderPrivate);
}

static inline void
put_image(struct dri_drawable *drawable, void *data, unsigned width, unsigned height)
{
   const __DRIswrastLoaderExtension *loader = drawable->screen->swrast_loader;

   loader->putImage(drawable, __DRI_SWRAST_IMAGE_OP_SWAP,
                    0, 0, width, height,
                    data, drawable->loaderPrivate);
}
```

兩個 inline helper 都從 `dri_screen` 取出同一張 swrast loader table，再把這一個 drawable 的 `loaderPrivate` 傳回 GLX。 `get_drawable_info()` 只查詢位置與尺寸，不配置 storage。 `put_image()` 則標示 swap 操作，把完整矩形的 CPU data 交給 loader。 查詢與資料交付分成兩次呼叫，因此 resize 驗證不會無條件搬動 pixels

`getDrawableInfo` 回傳的 `x`、`y` 供 native drawable 定位，resource 配置主要使用 `width` 與 `height`。 DRI frontend 不能從上一幀的 `pipe_resource` 反推目前視窗尺寸，因為 X server 端的 Window state 可能已在另一個 request 中改變

Attachment 驗證必須先收束 glthread 對同一個 `pipe_context` 的使用，再判斷要匯入 image-loader buffer，還是配置軟體 displaytarget。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/drisw.c:377`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/drisw.c#L377)，用來追蹤 `drisw_allocate_textures()` 如何準備 attachment template 與兩種 storage 路徑

```c
/**
 * Allocate framebuffer attachments.
 *
 * During fixed-size operation, the function keeps allocating new attachments
 * as they are requested. Unused attachments are not removed, not until the
 * framebuffer is resized or destroyed.
 */
static void
drisw_allocate_textures(struct dri_context *stctx,
                        struct dri_drawable *drawable,
                        const enum st_attachment_type *statts,
                        unsigned count)
{
   struct dri_screen *screen = drawable->screen;
   const __DRIswrastLoaderExtension *loader = drawable->screen->swrast_loader;
   struct pipe_resource templ;
   unsigned width, height;
   bool resized;
   unsigned i;
   const __DRIimageLoaderExtension *image = screen->image.loader;
   struct __DRIimageList images;
   bool imported_buffers = true;

   /* Wait for glthread to finish because we can't use pipe_context from
    * multiple threads.
    */
   _mesa_glthread_finish(stctx->st->ctx);
   ...
}
```

函式名稱中的 textures 是 drawable attachment 所用的 Gallium resources。 `statts` 可能要求 front-left、back-left 或其他 State Tracker attachment。 `templ` 稍後承載 format、尺寸、target 與 bind flag，再交給 `pipe_screen::resource_create`。 `images` 在 image loader 路徑中保存匯入結果

Drawable 尺寸改變時，舊 attachment references 與 buffer age 都必須失效，否則 framebuffer geometry 會和 storage 不一致。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/drisw.c:405`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/drisw.c#L405)，用來確認 `drisw_allocate_textures()` 的 image-import、resize detection 與 reference 清理

```c
static void
drisw_allocate_textures(struct dri_context *stctx,
                        struct dri_drawable *drawable,
                        const enum st_attachment_type *statts,
                        unsigned count)
{
...
   /* First try to get the buffers from the loader */
   if (image) {
      if (!dri_image_drawable_get_buffers(drawable, &images,
                                          statts, count))
         imported_buffers = false;
   }

   width  = drawable->w;
   height = drawable->h;

   resized = (drawable->old_w != width ||
              drawable->old_h != height);

   /* remove outdated textures */
   if (resized) {
      for (i = 0; i < ST_ATTACHMENT_COUNT; i++) {
         pipe_resource_reference(&drawable->textures[i], NULL);
         pipe_resource_reference(&drawable->msaa_textures[i], NULL);
      }
      drawable->buffer_age = 0;
   }
   ...
}
```

`pipe_resource_reference(&drawable->textures[i], NULL)` 表達釋放，而不是直接呼叫特定 driver 的 free。 resource 仍可能被 surface、view 或未完成工作引用，storage 要等最後一個 reference 消失才會回收

固定尺寸時，函式可以只為新出現的 attachment 配置 resource，不必刪除暫時未要求的 attachment。 resize 或 drawable destroy 才是全部 attachment 失效的明確邊界。 這種策略避免每次驗證都配置 front 與 back，也保留跨幀的 buffer age 與內容

```callgraph
Mesa 軟體 DRI drawable 驗證
=================================================
[Mesa: src/gallium/frontends/dri/drisw.c:377] drisw_allocate_textures(stctx, drawable, statts, count)
  │
  │  `_mesa_glthread_finish(stctx->st->ctx)`
  │  // 配置會使用 `pipe_context`，先收斂可能併行的 glthread work
  │
  ├─ 若 `screen->image.loader` 存在
  │    ├─ [Mesa: src/gallium/frontends/dri/dri2.c:111] dri_image_drawable_get_buffers(...)
  │    └─ 失敗時 `imported_buffers = false`
  │
  ├─ 若 `old_w != w || old_h != h`
  │    └─ `pipe_resource_reference(&drawable->textures[i], NULL)`
  │         // resize 後舊 attachment storage 不再符合 drawable 幾何
  │
  ├─ 若 loader 已回傳 front／back image
  │    └─ 參照 `images.front/back->texture`
  │
  └─ 否則
       └─ 依 `statts[i]` 與 `templ` 建立軟體 `pipe_resource`
  ↓
後續軟體 swap 階段
  ↓
[Mesa: src/gallium/frontends/dri/drisw.c:63] put_image(drawable, data, width, height)
  └─ swap 成功路徑將 CPU pixel range 交給 loader 的 `putImage` callback
```

軟體驗證以 GLX loader 的公開 callback 交出 drawable identity、矩形與 pixel data。 X server 接著擁有 clipping、Pixmap storage 與顯示排程，因此這組 callback 正是 Mesa 可驗證的 ownership 邊界

### DRI screen 分流後匯合成 `pipe_screen`

Drawable callback 解決了 driver 如何取得視窗資料，但 context 還需要一個能建立 resource、context 與 fence 的 `pipe_screen`。 GLX screen 已經握有 fd、loader extension 與 backend 類型。 現在要確認這些輸入在硬體與軟體分支中如何轉成同一種 Gallium contract。 這項連接決定後續 context 建立會取得哪個 driver callback table

#### GLX 建立 DRI screen

GLX screen 此時持有 X Display 與對應 X Screen 的編號，也保存 FBConfig／Visual 清單和 loader extensions。 現在要把這些原生識別資料交給 DRI frontend。 以下程式碼來自 [`Mesa: src/glx/dri_common.c:943`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri_common.c#L943)，用來追蹤 `dri_screen_init()` 如何初始化共通 GLX screen、選出 `dri_screen_type`，再進入 DRI screen 建立

```c
bool
dri_screen_init(struct glx_screen *psc, struct glx_display *priv, int screen, int fd, const __DRIextension **loader_extensions, bool driver_name_is_inferred)
{
   const struct dri_config **driver_configs;
   struct glx_config *configs = NULL, *visuals = NULL;

   if (!glx_screen_init(psc, screen, priv))
      return false;

   enum dri_screen_type type;
   switch (psc->display->driver) {
   case GLX_DRIVER_DRI3:
      type = DRI_SCREEN_DRI3;
      break;
   case GLX_DRIVER_ZINK_YES:
      type = DRI_SCREEN_KOPPER;
      break;
   case GLX_DRIVER_SW:
      type = DRI_SCREEN_SWRAST;
      break;
   default:
      UNREACHABLE("unknown glx driver type");
   }
   ...
}
```

`screen` 是目標 X Screen 的編號，`fd` 是 loader 已取得且要交給 DRI frontend 的 DRM file descriptor。 軟體路徑可以使用特殊值或由軟體 probe 決定 winsys，硬體 DRI3 路徑則以這個 fd 探測 kernel driver。 `loader_extensions` 是上一節的反向 callback 陣列，`driver_configs` 是 DRI screen 成功後回傳的 framebuffer configuration

在這個 Xorg／GLX 情境中，`GLX_DRIVER_DRI3` 與 `GLX_DRIVER_SW` 是兩個實際輸入分支。 兩條路最後都把 `dri_screen_init` 輸出接回 GLX config conversion，因此 GLX 公開 API 以統一的 screen 型態建立 FBConfig 與 Visual

選出 screen type 後，GLX 還要建立 frontend screen，並把 driver configs 配回既有的 FBConfig／Visual 清單。 以下程式碼來自 [`Mesa: src/glx/dri_common.c:967`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri_common.c#L967)，用來確認 `driCreateNewScreen3()` 的輸入、失敗清理，以及 config replacement 的邊界

```c
bool
dri_screen_init(struct glx_screen *psc,
                struct glx_display *priv,
                int screen,
                int fd,
                const __DRIextension **loader_extensions,
                bool driver_name_is_inferred)
{
...
   psc->frontend_screen = driCreateNewScreen3(screen, fd,
                                                 loader_extensions,
                                                 type,
                                                 &driver_configs, driver_name_is_inferred,
                                                 psc->display->has_multibuffer, psc);

   if (psc->frontend_screen == NULL) {
      goto handle_error;
   }

   configs = driConvertConfigs(psc->configs, driver_configs);
   visuals = driConvertConfigs(psc->visuals, driver_configs);

   if (!configs || !visuals) {
       ErrorMessageF("No matching fbConfigs or visuals found\n");
       goto handle_error;
   }

   glx_config_destroy_list(psc->configs);
   psc->configs = configs;
   glx_config_destroy_list(psc->visuals);
   psc->visuals = visuals;
   ...
}
```

最後一個 `psc` 參數成為 DRI screen 借用的 loader 私有資料。 drawable callback 回到 GLX 時，就能從這個 GLX-owned object 取得 Display、connection 與 screen state。 `driver_configs` 的 ownership 則轉入 GLX screen，後續 context 建立會由選定的 `glx_config` 找到對應 `driConfig`

DRI frontend 收到 screen type 後，必須選出具體的 `pipe_screen` factory，並讓 DRI config capability 來自建立成功的 driver screen。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri_util.c:130`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_util.c#L130)，用來追蹤 `driCreateNewScreen3()` 的 type dispatch 與共同失敗清理

```c
struct dri_screen *
driCreateNewScreen3(int scrn,
                    int fd,
                    const __DRIextension **loader_extensions,
                    enum dri_screen_type type,
                    const struct dri_config ***driver_configs,
                    bool driver_name_is_inferred,
                    bool has_multibuffer,
                    void *data)
{
...
   struct pipe_screen *pscreen = NULL;
   switch (type) {
   case DRI_SCREEN_DRI3:
      pscreen = dri2_init_screen(screen, driver_name_is_inferred);
      break;
   case DRI_SCREEN_KOPPER:
      pscreen = kopper_init_screen(screen, driver_name_is_inferred);
      break;
   case DRI_SCREEN_SWRAST:
      pscreen = drisw_init_screen(screen, driver_name_is_inferred);
      break;
   case DRI_SCREEN_KMS_SWRAST:
      pscreen = dri_swrast_kms_init_screen(screen, driver_name_is_inferred);
      break;
   default:
      UNREACHABLE("unknown dri screen type");
   }
   if (pscreen == NULL) {
      dri_destroy_screen(screen);
      return NULL;
   }
...
   *driver_configs = dri_init_screen(screen, pscreen, has_multibuffer);
   if (*driver_configs == NULL) {
      dri_destroy_screen(screen);
      return NULL;
   }
   ...
}
```

`dri2_init_screen()` 是 Gallium DRI frontend 沿用的硬體 screen helper 名稱。 固定版本的 GLX 硬體路徑由 DRI3 loader 進入，`type == DRI_SCREEN_DRI3`、image loader extension 與 DRM fd 才是辨識實際路徑的輸入

```callgraph
Mesa GLX screen 建立
=================================================
[Mesa: src/glx/dri_common.c:943] dri_screen_init(psc, priv, screen, fd, loader_extensions, ...)
  │
  ├─ 若 `glx_screen_init()` 失敗
  │    └─ `return false`
  │
  ├─ `psc->display->driver == GLX_DRIVER_DRI3`
  │    └─ `type = DRI_SCREEN_DRI3`
  └─ `psc->display->driver == GLX_DRIVER_SW`
       └─ `type = DRI_SCREEN_SWRAST`
  ↓
[Mesa: src/glx/dri_common.c:967] driCreateNewScreen3(screen, fd, loader_extensions, type, ...)
  │
  ├─ 失敗時
  │    └─ `return false`
  └─ 成功時
       └─ `psc->frontend_screen` 取得 `dri_screen`
  ↓
[Mesa: src/gallium/frontends/dri/dri_util.c:99] driCreateNewScreen3()
  ├─ 建立 `pipe_screen`
  └─ `driver_configs = dri_init_screen(...)`
       // GLX 以 configs 進一步配對 FBConfig 與 Visual
```

至此 GLX screen 擁有 DRI frontend screen，DRI screen 內又引用 Gallium `pipe_screen`。 三者不是同一個 object。 GLX screen 管理 X11 config 與公開 API，DRI screen 管理 loader contract，`pipe_screen` 管理 driver capability、resource factory 與 context factory

#### 硬體路徑

硬體 DRI3 screen 已持有 DRM fd，現在要探測相符的 Gallium device 並建立 `pipe_screen`。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri2.c:1748`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri2.c#L1748)，用來確認 `dri2_init_screen()` 如何連接 fd probe、buffer-sharing capability 與 screen factory

```c
/**
 * This is the driver specific part of the createNewScreen entry point.
 *
 * Returns the struct gl_config supported by this driver.
 */
struct pipe_screen *
dri2_init_screen(struct dri_screen *screen, bool driver_name_is_inferred)
{
   struct pipe_screen *pscreen = NULL;

   screen->can_share_buffer = true;

#ifdef HAVE_LIBDRM
   if (pipe_loader_drm_probe_fd(&screen->dev, screen->fd, false))
      pscreen = pipe_loader_create_screen(screen->dev, driver_name_is_inferred);
#endif

   return pscreen;
}
```

`screen->can_share_buffer = true` 告訴共同 DRI frontend，這條 screen 能讓 loader 與 driver 以 image／handle 分享 drawable storage。 它不是「所有 resource 都自動可分享」的宣告。 建立 resource 時仍須使用相應 bind flag，匯出時也要有 driver 與 kernel 支援的 handle type、format、plane、stride、offset 與 modifier

`pipe_loader_drm_probe_fd()` 以現有 fd 探測 driver，結果保存於 `screen->dev`。 這個 pipe-loader device 包含 driver descriptor、option cache 與建立 screen 所需的 probe state。 `pipe_loader_create_screen()` 再呼叫 descriptor 的 screen factory。 若 probe 或 factory 失敗，函式回傳 NULL，`driCreateNewScreen3()` 會銷毀尚未完成的 DRI screen

`driver_name_is_inferred` 保留 loader 判定 driver 名稱的來源資訊，讓建立 screen 的路徑能區分明確指定與推導結果。 對 VirGL 而言，pipe-loader descriptor 最終會選到 `virtio_gpu` 對應的 screen factory，再以後續的 winsys 與 capset 初始化實作共同 `pipe_screen` contract

DRM fd 的 ownership 分成外部 fd 與 driver 長期 reference。 GLX loader 取得 fd 並交給 DRI frontend，driver screen 或 winsys 為長期使用複製它。 fd 數值只在目前行程的 file descriptor table 有意義，複製操作建立的是同一 file description 的新 reference

```callgraph
Mesa Gallium DRI 硬體 screen
=================================================
[Mesa: src/gallium/frontends/dri/dri_util.c:99] driCreateNewScreen3()
  └─ 當 `type == DRI_SCREEN_DRI3`
       └─ [Mesa: src/gallium/frontends/dri/dri2.c:1748] dri2_init_screen(screen, driver_name_is_inferred)
  │
  ├─ `pipe_loader_drm_probe_fd(&screen->dev, screen->fd, ...)` 失敗
  │    └─ `return NULL`
  │         // DRM fd 無法對應可用 driver descriptor
  │
  └─ probe 成功
       └─ `screen->dev` 保存 driver descriptor 與 fd-specific state
  ↓
[Mesa: src/gallium/auxiliary/pipe-loader/pipe_loader.c:179] pipe_loader_create_screen(screen->dev, ...)
  │
  └─ `dev->ops->create_screen(dev, ...)`
       // 由已選定的硬體 driver factory 產生 callback table
  ↓
[Mesa: src/gallium/frontends/dri/dri_util.c:151] dri_init_screen(screen, pscreen, has_multibuffer)
  └─ 成功結果：`dri_screen` 持有硬體 `pipe_screen`
```

成功後，DRI frontend 只透過 `pipe_screen` 查詢 format capability、建立 resource、建立 context 與管理 fence。 GLX loader 不必知道硬體 driver 的私有 screen struct。 反過來，driver 也不必知道 X Display 或 FBConfig 的具體欄位

#### 軟體路徑

軟體 GLX 路徑要先把 swrast loader callbacks 包成 `sw_winsys`，再選出軟體 `pipe_screen`。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/drisw.c:597`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/drisw.c#L597)，用來追蹤 `drisw_init_screen()` 如何選 loader callback table，以及如何在 KMS 與基本 DRI 軟體 probe 間分流

```c
struct pipe_screen *
drisw_init_screen(struct dri_screen *screen, bool driver_name_is_inferred)
{
   const __DRIswrastLoaderExtension *loader = screen->swrast_loader;
   struct pipe_screen *pscreen = NULL;
   const struct drisw_loader_funcs *lf = &drisw_lf;

   screen->swrast_no_present = debug_get_option_swrast_no_present();

   if (loader->base.version >= 4) {
      if (loader->putImageShm)
         lf = &drisw_shm_lf;
   }

   bool success = false;
#ifdef HAVE_DRISW_KMS
   if (screen->fd != -1)
      success = pipe_loader_sw_probe_kms(&screen->dev, screen->fd);
#endif
   if (!success)
      success = pipe_loader_sw_probe_dri(&screen->dev, lf);

   if (success)
      pscreen = pipe_loader_create_screen(screen->dev, driver_name_is_inferred);

   return pscreen;
}
```

`loader` 必須存在，因為純 drisw 需要由 GLX callback 取得 drawable 與交付 pixels。 version 4 以上且 `putImageShm` 非空時，frontend 選擇 `drisw_shm_lf`，否則使用基本 `drisw_lf`。 Version 檢查保證 struct 尾端在可讀範圍，函式指標檢查再確認提供端實際安裝了 shared-memory callback

若建置啟用 `HAVE_DRISW_KMS` 且 screen 有 fd，`pipe_loader_sw_probe_kms()` 先嘗試軟體 KMS winsys。 KMS probe 未執行或失敗時，`pipe_loader_sw_probe_dri()` 才把 `drisw_loader_funcs` 交給軟體 winsys。 這個 callback table 是 DRI extension 的另一層包裝，讓 Gallium 軟體 target 不必直接使用 `__DRIswrastLoaderExtension`

軟體 probe 成功後，還要依 driver name 與建置能力選擇 renderer factory。 以下程式碼來自 [`Mesa: src/gallium/auxiliary/target-helpers/sw_helper.h:36`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/target-helpers/sw_helper.h#L36)，用來確認 `sw_screen_create_named()` 如何在 llvmpipe、virpipe 與 softpipe factories 間分流

```c
static inline struct pipe_screen *
sw_screen_create_named(struct sw_winsys *winsys, const struct pipe_screen_config *config, const char *driver)
{
   struct pipe_screen *screen = NULL;

#if defined(GALLIUM_LLVMPIPE)
   if (screen == NULL && (strcmp(driver, "llvmpipe") == 0 || !driver[0]))
      screen = llvmpipe_create_screen(winsys);
#endif

#if defined(GALLIUM_VIRGL)
   if (screen == NULL && strcmp(driver, "virpipe") == 0) {
      struct virgl_winsys *vws;
      vws = virgl_vtest_winsys_wrap(winsys);
      screen = virgl_create_screen(vws, NULL);
   }
#endif

#if defined(GALLIUM_SOFTPIPE)
   if (screen == NULL && strcmp(driver, "softpipe") == 0)
      screen = softpipe_create_screen(winsys);
#endif
   ...
}
```

這個片段顯示 renderer name、winsys 與 screen factory 的三個角色。 `driver` 是選擇字串，`winsys` 是外部 storage／display contract，`llvmpipe_create_screen()` 或 `softpipe_create_screen()` 才建立含有 driver callback 的 `pipe_screen`。 同一個 winsys 可以被不同 CPU renderer 使用，driver 也能在不同 winsys 上建立 screen

`sw_screen_create_named()` 的 factory 集合由建置組態決定，其中 `virpipe` 是測試型 wrapper。 `sw_screen_create_vk()` 將 `GALLIUM_DRIVER` 的值交給這個 helper。 空字串可選 llvmpipe，明確的 `virpipe` 或 `softpipe` 只會進入同名分支，未知的非空字串則讓建立流程回傳 NULL

軟體 `pipe_screen` 建立後，DRI frontend 產生的 configs 與硬體路徑採相同輸出型態。 GLX context 建立、make-current 與 State Tracker 因而不必為 llvmpipe 或 softpipe 定義另一套公開 object。 差異留在 `pipe_screen::context_create`、`pipe_context::draw_vbo`、resource map 與 flush callback 後面

```callgraph
Mesa Gallium DRI 軟體 screen
=================================================
[Mesa: src/gallium/frontends/dri/drisw.c:597] drisw_init_screen(screen, driver_name_is_inferred)
  │
  │  `lf = &drisw_lf`
  │  // 基本 loader funcs 以 CPU memory 與 GLX drawable 交換 pixels
  │
  ├─ 若 `loader->base.version >= 4 && loader->putImageShm`
  │    └─ `lf = &drisw_shm_lf`
  │         // 同時確認 ABI version 與 callback 可用性
  │
  ├─ 若建置啟用 `HAVE_DRISW_KMS && screen->fd != -1`
  │    └─ `success = pipe_loader_sw_probe_kms(&screen->dev, screen->fd)`
  │
  ├─ 若 `!success`
  │    └─ `success = pipe_loader_sw_probe_dri(&screen->dev, lf)`
  │         // KMS probe 未執行或失敗時才走 DRI probe
  │
  ├─ 若 `!success`
  │    └─ `return NULL`
  │
  └─ `success == true`
       └─ `pipe_loader_create_screen(screen->dev, ...)`
  ↓
[Mesa: src/gallium/auxiliary/target-helpers/sw_helper.h:36] sw_screen_create_named(winsys, driver)
  │
  ├─ 若已建入 llvmpipe 且 `driver == "" || driver == "llvmpipe"`
  │    └─ `llvmpipe_create_screen(winsys)`
  ├─ 若已建入 VirGL 且 `driver == "virpipe"`
  │    └─ `virgl_vtest_winsys_wrap(winsys)` 後建立 virpipe screen
  ├─ 若已建入 softpipe 且 `driver == "softpipe"`
  │    └─ `softpipe_create_screen(winsys)`
  └─ 若未命中任何已建入的 factory 分支
       └─ `return NULL`
            // 非 softpipe 不等於 llvmpipe。 名稱必須命中對應分支
```

screen 分流在這裡重新匯合。 硬體與軟體路徑都會將 `pipe_screen` 寫入 DRI screen，並用同一組 DRI configs 描述 OpenGL framebuffer 能力。 drawable storage 的取得方式仍不同，DRI3 透過 image loader，drisw 透過 swrast loader 與軟體 winsys。 共同 `pipe_screen` contract 不會抹去這項差異，只讓上游可以用相同 callback 形狀操作它們

### `gbm_device`、`gbm_bo` 與 `gbm_surface`

DRI screen 路徑已經顯示 Mesa 如何從 DRM fd 建立 driver screen，而 Xorg modesetting 還會透過 GBM，以同一個 fd 配置一份可供 scanout、且能在本文組態中進行 CPU mapping 的 buffer object。 若沒有先分清 `gbm_device`、`gbm_bo` 與 `gbm_surface` 各自保存的資訊，後面很容易把 backend selection、實際 storage 配置與 surface 組態當成同一個動作。 這一節從 versioned backend ABI 進入 device selection，再追蹤本文 mapped front BO 可能經過的兩條建立路徑、KMS reference 與 teardown

前面固定組態中的 Xorg `gbm_create_front_bo()` 會依序嘗試多組 usage flags。 Mesa GBM DRI backend 可以載入 `kms_swrast` DRI 軟體 driver，BO 配置則會依 usage 與 dma-buf export capability 在 direct dumb BO 和 DRI image 之間分流

本例最後取得可 mapping 的 GBM front BO，而且底層 storage 建立抵達 `DRM_IOCTL_MODE_CREATE_DUMB`。 哪一組 candidate 成功，以及公開 wrapper 是 direct dumb BO 還是包住 DRI image，仍由當時可用的 backend 與 capability 決定

#### Versioned backend ABI

GBM 公開 object 需要讓 loader 與可替換 backend 共用 memory layout。 以下程式碼來自 [`Mesa: src/gbm/main/gbm_backend_abi.h:75`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm_backend_abi.h#L75)，用來確認 append-only ABI 如何透過 versioned device prefix 保存協商版本、fd、名稱與 backend dispatch

```c
#define GBM_BACKEND_ABI_VERSION 1

/**
 * GBM device interface corresponding to GBM_BACKEND_ABI_VERSION = 0
 *
 * DO NOT MODIFY THIS STRUCT. Instead, introduce a gbm_bo_v1, increment
 * GBM_BACKEND_ABI_VERSION, and append gbm_bo_v1 to gbm_bo.
 */
struct gbm_device_v0 {
   const struct gbm_backend_desc *backend_desc;

   /**
    * The version of the GBM backend interface supported by this device and its
    * child objects. This may be less than the maximum version supported by the
    * GBM loader if the device was created by an older backend, or less than the
    * maximum version supported by the backend if the device was created by an
    * older loader. In other words, this will be:
    *
    *   MIN(backend GBM interface version, loader GBM interface version)
    *
    * It is the backend's responsibility to assign this field the value passed
    * in by the GBM loader to the backend's create_device function. The GBM
    * loader will pre-clamp the value based on the loader version and the
    * version reported by the backend in its gbm_backend_v0::backend_version
    * field. It is the loader's responsibility to respect this version when
    * directly accessing a device instance or any child objects instantiated by
    * a device instance.
    */
   uint32_t backend_version;

   int fd;
   const char *name;
   ...
```

`backend_version` 是 loader 與 backend 最高版本的較小值，child BO 與 surface 也必須依它存取尾端欄位。 `fd` 仍由呼叫端提供，device object 不把它變成跨行程 identity。 `backend_desc` 則記錄建立 device 的 backend 與動態函式庫生命週期

`gbm_bo` 與 `gbm_surface` 都要保存 owning device，但 BO 的欄位描述已配置好的 storage，surface 的欄位則描述建立 BO 時使用的條件。 以下程式碼來自 [`Mesa: src/gbm/main/gbm_backend_abi.h:198`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm_backend_abi.h#L198)，用來確認兩種公開 wrapper 的共同 prefix 與 version-0 payload 有何差異

```c
struct gbm_bo {
   struct gbm_device *gbm;
   struct gbm_bo_v0 v0;
};

...

struct gbm_surface_v0 {
   uint32_t width;
   uint32_t height;
   uint32_t format;
   uint32_t flags;
   struct {
      uint64_t *modifiers;
      unsigned count;
   };
};

...

struct gbm_surface {
   struct gbm_device *gbm;
   struct gbm_surface_v0 v0;
};
```

`gbm_bo` 與 `gbm_surface` 都不是 `pipe_resource`。 DRI backend 會在自己的 subclass 中加入 `dri_image`、mapping 或其他私有欄位。 公開 API 只經 `gbm_device_v0` 的 callback dispatch，不能直接假定 backend subclass 的排列。 這使 GBM core 能驗證參數與維持 ABI，實際配置仍由 driver integration 層完成

#### Device 建立與 backend selection

`gbm_create_device()` 從呼叫端提供的 fd 進入 backend loader。 以下程式碼來自 [`Mesa: src/gbm/main/gbm.c:127`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/gbm.c#L127)，用來確認公開入口如何驗證 fd、處理 backend 建立失敗，並初始化成功 object 的 ABI identity

```c
GBM_EXPORT struct gbm_device *
gbm_create_device(int fd)
{
   struct gbm_device *gbm = NULL;
   struct stat buf;

   if (fd < 0 || fstat(fd, &buf) < 0 || !S_ISCHR(buf.st_mode)) {
      errno = EINVAL;
      return NULL;
   }

   gbm = _gbm_create_device(fd);
   if (gbm == NULL)
      return NULL;

   gbm->dummy = gbm_create_device;

   return gbm;
}
```

完成 fd 驗證後，loader 還要決定由哪個 GBM backend 建立 device。 以下程式碼來自 [`Mesa: src/gbm/main/backend.c:146`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/main/backend.c#L146)，用來追蹤 `_gbm_create_device()` 如何依序嘗試環境變數指定、DRM driver name 與通用 `dri` backend

```c
struct gbm_device *
_gbm_create_device(int fd)
{
   struct gbm_device *dev = NULL;

   const char *b = os_get_option("GBM_BACKEND");
   if (b) {
      dev = load_backend_by_name(b, fd, true);
      if (dev) return dev;
   }

   drmVersionPtr v = drmGetVersion(fd);
   if (v) {
      dev = load_backend_by_name(v->name, fd, false);
      drmFreeVersion(v);
      if (dev) return dev;
   }

   return load_backend_by_name("dri", fd, true);
}
```

DRM version object 在使用後立即由 `drmFreeVersion()` 釋放，GBM device 只複製它需要的 driver name。 backend loader 成功時，`backend_desc` 與函式庫 handle 的 reference 跟著 device，`gbm_device_destroy()` 在 backend destroy 後釋放描述物。 建立 device 的呼叫端繼續擁有外部 fd 的關閉責任

#### DRI backend 同時扮演 DRI loader

DRI backend 的 `gbm_dri_device` 既是 GBM backend object，也是建立 DRI screen 時的 loader 私有 owner。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_dri.c:240`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L240)，用來追蹤 `dri_screen_create_for_driver()` 如何由 driver name 選出 screen type，準備 loader extensions，再以 fd 與 owning `gbm_dri_device` 建立 DRI screen

```c
static const __DRIextension *gbm_dri_screen_extensions[] = {
   &image_lookup_extension.base,
   &image_loader_extension.base,
   &swrast_loader_extension.base,
   &kopper_loader_extension.base,
   NULL,
};

static int
dri_screen_create_for_driver(struct gbm_dri_device *dri, char *driver_name, bool driver_name_is_inferred)
{
   bool swrast = driver_name == NULL; /* If it's pure swrast, not just swkms. */
   enum dri_screen_type type = DRI_SCREEN_SWRAST;
   if (!swrast) {
      if (!strcmp(driver_name, "zink"))
         type = DRI_SCREEN_KOPPER;
      else if (!strcmp(driver_name, "kms_swrast"))
         type = DRI_SCREEN_KMS_SWRAST;
      else
         type = DRI_SCREEN_DRI3;
   }

   dri->driver_name = swrast ? strdup("swrast") : driver_name;

   dri->swrast = swrast;

   dri->loader_extensions = gbm_dri_screen_extensions;
   dri->screen = driCreateNewScreen3(0, swrast ? -1 : dri->base.v0.fd,
                                             dri->loader_extensions,
                                             type,
                                             &dri->driver_configs, driver_name_is_inferred, true, dri);
   ...
}
```

這段 extension 陣列由 GBM 建立並提供給 `driCreateNewScreen3()`。 `dri` 同時作為最後一個 loader 私有參數，因此 image lookup、軟體 image 或其他 loader callback 可以找回 owning device。 `driCreateNewScreen3()` 的 `scrn` 參數固定傳入 0，因為 GBM device 不屬於 X Display 的多 screen namespace

硬體 driver 使用 GBM device 的 fd，純 swrast 則傳入 -1。 `type` 決定前一節看過的 DRI screen 分流，成功後仍得到共同 `pipe_screen`。 GBM DRI backend 因而不是在 Gallium 旁邊另外實作一套 storage 配置機制，它透過 DRI screen 取得同一組 resource、image、mapping 與 fence 能力

backend descriptor 在 [`Mesa: src/gbm/backends/dri/gbm_dri.c:1260`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L1260) 將名稱 `dri` 與 `dri_device_create()` 綁在一起。 device factory 再安裝 BO、map、handle、modifier、surface 與 destroy callbacks。 公開 GBM 呼叫只沿這組 dispatch 進入 backend，不直接接觸 `dri_screen`

#### BO 配置在 dumb BO 與 DRI image 間分流

公開 `gbm_bo_create()` 只驗證參數並呼叫 backend 的 `bo_create` callback，底層 storage policy 要到 DRI backend 才分流。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_dri.c:886`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L886)，用來確認 `GBM_BO_USE_WRITE`、dma-buf export capability 與其餘 usage 如何把配置導向 direct dumb BO 或 DRI image

```c
static struct gbm_bo *
gbm_dri_bo_create(struct gbm_device *gbm,
                  uint32_t width, uint32_t height,
                  uint32_t format, uint32_t usage,
                  const uint64_t *modifiers,
                  const unsigned int count)
{
   struct gbm_dri_device *dri = gbm_dri_device(gbm);
   struct gbm_dri_bo *bo;
   int pipe_format;
   unsigned dri_use = 0;
   ...

   format = core->v0.format_canonicalize(format);

   if (usage & GBM_BO_USE_WRITE || !dri->has_dmabuf_export)
      return create_dumb(gbm, width, height, format, usage);

   bo = calloc(1, sizeof *bo);
   if (bo == NULL)
      return NULL;

   bo->base.gbm = gbm;
   bo->base.v0.width = width;
   bo->base.v0.height = height;
   bo->base.v0.format = format;
   ...

   bo->image = dri_create_image_with_modifiers(...);
   ...
   return &bo->base;
}
```

這次提前回傳是兩條 storage 路徑的分界。 `GBM_BO_USE_WRITE` 表示呼叫端要求 CPU-write-oriented use； 在這份 DRI backend 實作中，它會選 dumb BO。 即使 usage 沒有 `WRITE`，backend 無法匯出 dma-buf 時也會走同一支。 因此「建立 `gbm_bo`」不等於「立即建立 DRI image」

兩條配置分支最後都回傳公開 `struct gbm_bo *`，各分支特有的 state 則放在 backend 私有 object。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_driint.h:100`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_driint.h#L100)，用來確認一個 `gbm_dri_bo` 如何同時容納 DRI image state，以及 direct dumb BO 的 handle、size 與 mapping

```c
struct gbm_dri_bo {
   struct gbm_bo base;

   struct dri_image *image;

   /* Used for cursors and the swrast front BO */
   uint32_t handle, size;
   void *map;
};
```

#### Direct dumb 分支與 persistent mapping

先看 direct dumb 分支。 Xorg `gbm_create_front_bo()` 的 usage candidates 可能帶入 `GBM_BO_USE_WRITE | GBM_BO_USE_SCANOUT`。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_dri.c:827`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L827)，用來追蹤 `create_dumb()` 如何先驗證用途與 format，接著建立 GEM dumb BO、填入公開／私有 BO state，最後啟動 CPU mapping

```c
static struct gbm_bo *
create_dumb(struct gbm_device *gbm,
            uint32_t width, uint32_t height,
            uint32_t format, uint32_t usage)
{
   struct gbm_dri_device *dri = gbm_dri_device(gbm);
   struct drm_mode_create_dumb create_arg;
   struct gbm_dri_bo *bo;
   struct drm_mode_destroy_dumb destroy_arg;
   int ret;
   int is_cursor, is_scanout;

   is_cursor = (usage & GBM_BO_USE_CURSOR) != 0 &&
      format == GBM_FORMAT_ARGB8888;
   is_scanout = (usage & GBM_BO_USE_SCANOUT) != 0 &&
      (format == GBM_FORMAT_XRGB8888 || format == GBM_FORMAT_XBGR8888);
   if (!is_cursor && !is_scanout) {
      errno = EINVAL;
      return NULL;
   }

   bo = calloc(1, sizeof *bo);
   if (bo == NULL)
      return NULL;

   memset(&create_arg, 0, sizeof(create_arg));
   create_arg.bpp = 32;
   create_arg.width = width;
   create_arg.height = height;

   ret = drmIoctl(dri->base.v0.fd,
                  DRM_IOCTL_MODE_CREATE_DUMB, &create_arg);
   if (ret)
      goto free_bo;

   bo->base.gbm = gbm;
   bo->base.v0.width = width;
   bo->base.v0.height = height;
   bo->base.v0.stride = create_arg.pitch;
   bo->base.v0.format = format;
   bo->base.v0.handle.u32 = create_arg.handle;
   bo->handle = create_arg.handle;
   bo->size = create_arg.size;

   if (gbm_dri_bo_map_dumb(bo) == NULL)
      goto destroy_dumb;

   return &bo->base;
   ...
}
```

建立 dumb BO 後，backend 還要把同一份 storage 映入 Xorg 行程。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_driint.h:134`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_driint.h#L134)，用來追蹤 `gbm_dri_bo_map_dumb()` 如何從 BO handle 取得 mmap offset，並建立 persistent mapping

```c
static inline void *
gbm_dri_bo_map_dumb(struct gbm_dri_bo *bo)
{
   struct drm_mode_map_dumb map_arg;
   int ret;

   if (bo->image != NULL)
      return NULL;

   if (bo->map != NULL)
      return bo->map;

   memset(&map_arg, 0, sizeof(map_arg));
   map_arg.handle = bo->handle;

   ret = drmIoctl(bo->base.gbm->v0.fd,
                  DRM_IOCTL_MODE_MAP_DUMB, &map_arg);
   if (ret)
      return NULL;

   bo->map = mmap(NULL, bo->size, PROT_WRITE,
                  MAP_SHARED, bo->base.gbm->v0.fd, map_arg.offset);
   if (bo->map == MAP_FAILED) {
      bo->map = NULL;
      return NULL;
   }

   return bo->map;
}
```

Xorg 稍後呼叫公開 map API 時，不必知道 BO 採用哪一種 backend 私有 object。 以下兩段程式碼分別來自 Mesa DRI backend 與 Xorg modesetting，用來追蹤 direct dumb BO 如何回傳既有 mapping、DRI image 如何改走 resource mapping 路徑，以及 Xorg 最後保存哪些 mapping 結果

```c
// [Mesa: src/gbm/backends/dri/gbm_dri.c:1040]
static void *
gbm_dri_bo_map(struct gbm_bo *_bo,
               uint32_t x, uint32_t y,
               uint32_t width, uint32_t height,
               uint32_t flags, uint32_t *stride, void **map_data)
{
   struct gbm_dri_bo *bo = gbm_dri_bo(_bo);

   /* If it's a dumb buffer, we already have a mapping */
   if (bo->map) {
      *map_data = (char *)bo->map + (bo->base.v0.stride * y) + (x * 4);
      *stride = bo->base.v0.stride;
      return *map_data;
   }
   ...

   /* GBM flags and DRI flags are the same, so just pass them on */
   return dri2_map_image(dri->context, bo->image, x, y,
                         width, height, flags, (int *)stride,
                         map_data);
}

// [Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:101]
static inline Bool
gbm_bo_map_all(struct gbm_bo *bo, bo_priv_t *data)
{
   uint32_t stride = 0;
   ...

   data->map_data = NULL;
   data->map_addr = gbm_bo_map(bo, 0, 0,
                               gbm_bo_get_width(bo),
                               gbm_bo_get_height(bo),
                               GBM_BO_TRANSFER_READ_WRITE,
                               &stride, &data->map_data);

   return !!data->map_addr;
}
```

`data->map_addr` 是 Xorg 後來交給 screen `PixmapRec::devPrivate.ptr` 的 pixel 位址； `data->map_data` 則是 opaque token，teardown 時必須原封不動傳回 `gbm_bo_unmap()`。 因此 screen Pixmap 與 mapped front BO 並不是兩份 pixel 副本：Pixmap 透過這個位址存取 front BO 的底層 storage。 只有在 direct dumb 分支中，這個位址才是 `gbm_dri_bo::map` 內的位址

把 Xorg factory、GBM 公開 dispatch、DRI backend 分支與 screen Pixmap installation 接起來後，完整建立路徑如下。 兩條分支都可能產生可 mapping 的 GBM BO，也都可能在不同層抵達 `DRM_IOCTL_MODE_CREATE_DUMB`。 本文現有執行期 evidence 不能判定哪條分支成功，因此 callgraph 保留兩者，並在共同的 Xorg mapping 操作重新匯合

```callgraph
Xorg front BO 配置
=================================================
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_display.c:4838] drmmode_create_initial_bos(...)
  └─ `drmmode->front_bo = gbm_create_best_bo(..., DRMMODE_FRONT_BO)`
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:272] gbm_create_best_bo(...)
  └─ [Xorg: drmmode_bo.c:196] gbm_create_front_bo(...)
       └─ 依序嘗試 scanout usage candidates
  ↓
[Mesa: src/gbm/main/gbm.c:489/527] gbm_bo_create*()
  └─ `gbm->v0.bo_create(...)`
       // 實際 callback 由已選定的 GBM backend 提供
  ↓
[Mesa: src/gbm/backends/dri/gbm_dri.c:886] gbm_dri_bo_create(...)
  ├─ `usage & GBM_BO_USE_WRITE || !dri->has_dmabuf_export`
  │    ↓
  │  [Mesa: gbm_dri.c:827] create_dumb(...)
  │    ├─ `DRM_IOCTL_MODE_CREATE_DUMB`
  │    └─ [Mesa: gbm_driint.h:134] gbm_dri_bo_map_dumb(...)
  │         ├─ `DRM_IOCTL_MODE_MAP_DUMB`
  │         └─ `mmap(...)`
  │
  └─ 其他 usage／capability
       ↓
     [Mesa: src/gbm/backends/dri/gbm_dri.c:1015] gbm_dri_bo_create(...)
       └─ `dri_create_image_with_modifiers(...)`
            // 這裡是呼叫點，不是 helper 的函式 definition
       ↓
     [Mesa: src/gallium/frontends/dri/dri_helpers.c:834]
     dri_create_image_with_modifiers(...)
       ↓
     [Mesa: src/gallium/frontends/dri/dri2.c:947] dri_create_image(...)
       └─ `pipe_screen->resource_create(..., PIPE_BIND_SCANOUT, ...)`
            ↓
          [Mesa: src/gallium/drivers/softpipe/sp_texture.c:155] softpipe_resource_create_front(...)
            └─ `winsys->displaytarget_create(...)`
                 ↓
               [Mesa: src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c:165]
               kms_sw_displaytarget_create(...)
                 └─ `DRM_IOCTL_MODE_CREATE_DUMB`
  ↓
[Xorg: drmmode_bo.c:101] gbm_bo_map_all(...)
  └─ `gbm_bo_map(...)`
       ├─ direct dumb 分支：回傳 `gbm_dri_bo::map` 內的位址
       └─ DRI image 分支
            ↓
          [Mesa: gbm_dri.c:1040] gbm_dri_bo_map(...)
            └─ [Mesa: dri2.c:1597] dri2_map_image(...)
                 └─ `pipe_texture_map(...)`
                      ↓
                    [Mesa: sp_texture.c:296] softpipe_transfer_map(...)
                      └─ `winsys->displaytarget_map(...)`
                           ↓
                         [Mesa: kms_dri_sw_winsys.c:312] kms_sw_displaytarget_map(...)
                           ├─ `DRM_IOCTL_MODE_MAP_DUMB`
                           └─ `mmap(...)`
  ↓
[Xorg: drmmode_bo.c:296] gbm_bo_set_user_data(..., destroy_user_data)
  ↓
[Xorg: hw/xfree86/drivers/video/modesetting/driver.c:1722] modesetCreateScreenResources(...)
  └─ 將 `gbm_bo_get_map(front_bo)` 安裝到 screen Pixmap
```

#### KMS framebuffer 引用同一份 BO storage

`gbm_bo` 建立 storage 後，KMS 還需要 framebuffer object，plane／CRTC 才能引用它。 以下兩段程式碼分別來自 Xorg modesetting 的 CRTC setup 與 BO import helper，用來確認 `fb_id` 尚未建立時，Xorg 如何把同一個 `front_bo` 的 handle 與 layout 交給 libdrm `drmModeAddFB*()`

```c
// [Xorg: hw/xfree86/drivers/video/modesetting/drmmode_display.c:654]
Bool
drmmode_crtc_get_fb_id(xf86CrtcPtr crtc,
                       uint32_t *fb_id, int *x, int *y)
{
   ...
   if (*fb_id == 0) {
      ret = drmmode_bo_import(drmmode, drmmode->front_bo,
                              &drmmode->fb_id);
      if (ret < 0)
         return FALSE;
      *fb_id = drmmode->fb_id;
   }

   return TRUE;
}

// [Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:339]
int
drmmode_bo_import(drmmode_ptr drmmode, struct gbm_bo *bo,
                  uint32_t *fb_id)
{
   uint32_t width = gbm_bo_get_width(bo);
   uint32_t height = gbm_bo_get_height(bo);
   ...

   return drmModeAddFB(drmmode->fd, width, height,
                       drmmode->scrn->depth, drmmode->kbpp,
                       gbm_bo_get_stride(bo),
                       gbm_bo_get_handle(bo).u32, fb_id);
}
```

`drmmode_rec::front_bo` 保存 userspace BO reference，`drmmode->fb_id` 保存 KMS framebuffer ID

`drmModeAddFB()` request 會帶入目前 DRM file namespace 中的 GEM handle。 Kernel 用它查出 GEM object，成功建立的 DRM framebuffer 再保存該 object 的 reference。 Handle 是 lookup key，不是 framebuffer 長期持有的 reference。 `drmModeRmFB()` 移除 framebuffer 時才釋放這一層 framebuffer reference

screen Pixmap mapping、GBM BO、GEM object 與 KMS framebuffer 因此組成一條 ownership／reference chain，而不是四份 pixel data

#### Front BO teardown

Xorg 關閉 screen 時先移除 KMS framebuffer reference，再銷毀 `front_bo`。 公開 `gbm_bo_destroy()` 會先執行 Xorg 註冊的 user-data destructor，然後才呼叫 backend `bo_destroy`

```callgraph
Xorg screen teardown
=================================================
[Xorg: hw/xfree86/drivers/video/modesetting/driver.c:2309] CloseScreen(...)
  └─ [Xorg: drmmode_display.c:4897] drmmode_free_bos(...)
       ├─ `drmModeRmFB(drmmode->fd, drmmode->fb_id)`
       └─ `gbm_bo_destroy(drmmode->front_bo)`
  ↓
[Mesa: src/gbm/main/gbm.c:464] gbm_bo_destroy(bo)
  ├─ 先呼叫 `bo->v0.destroy_user_data(bo, bo->v0.user_data)`
  │    └─ [Xorg: drmmode_bo.c:73] destroy_user_data(bo, data)
  │         └─ `gbm_bo_unmap(bo, data->map_data)`
  └─ 再呼叫 `bo->gbm->v0.bo_destroy(bo)`
       ↓
[Mesa: src/gbm/backends/dri/gbm_dri.c:649] gbm_dri_bo_destroy(bo)
  ├─ `bo->image != NULL`
  │    ↓
  │  [Mesa: src/gallium/frontends/dri/dri_helpers.c:311] dri2_destroy_image(...)
  │    └─ `pipe_resource_reference(&img->texture, NULL)`
  │         ↓
  │       [Mesa: src/gallium/drivers/softpipe/sp_texture.c:199] softpipe_resource_destroy(...)
  │         └─ `winsys->displaytarget_destroy(...)`
  │              ↓
  │            [Mesa: src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c:275]
  │            kms_sw_displaytarget_destroy(...)
  │              └─ `DRM_IOCTL_MODE_DESTROY_DUMB`
  │
  └─ direct dumb BO：
       ├─ `gbm_dri_bo_unmap_dumb(bo)` 執行 `munmap()`
       └─ `DRM_IOCTL_MODE_DESTROY_DUMB`
            ↓
[Linux: drivers/gpu/drm/drm_dumb_buffers.c:288] drm_mode_destroy_dumb(...)
  └─ `drm_gem_handle_delete(file_priv, handle)`
```

Direct dumb 分支的公開 `gbm_bo_unmap()` callback 只驗證 opaque pointer 位於 persistent mapping 範圍內，不會當場 `munmap()`。 真正解除 mapping 的時間是 backend destroy

DRI image 分支會先釋放 image 持有的 `pipe_resource`。 若 resource 使用 `kms-dri` display target，resource destroy 會走到另一個 `DRM_IOCTL_MODE_DESTROY_DUMB` 呼叫端

兩條分支最後都刪除各自 DRM file 內的 GEM handle，底層 GEM object 則依 refcounting，在最後一個 reference 消失後回收

#### DRI image 分支底下也可能使用 dumb BO

若 DRI backend 沒有從 `create_dumb()` 提前回傳，就會進入 DRI image 分支。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_dri.c:1015`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L1015)，用來追蹤 image 配置、公開 handle／stride query 與失敗清理

```c
static struct gbm_bo *
gbm_dri_bo_create(struct gbm_device *gbm,
                  uint32_t width, uint32_t height,
                  uint32_t format, uint32_t usage,
                  const uint64_t *modifiers,
                  const unsigned int count)
{
   ...
   bo->image = dri_create_image_with_modifiers(
      dri->screen, width, height, pipe_format, dri_use,
      mods_filtered ? mods_filtered : modifiers,
      mods_filtered ? count_filtered : count, bo);
   if (bo->image == NULL)
      goto failed;

   free(mods_filtered);
   mods_filtered = NULL;

   dri2_query_image(bo->image, __DRI_IMAGE_ATTRIB_HANDLE,
                    &bo->base.v0.handle.s32);
   dri2_query_image(bo->image, __DRI_IMAGE_ATTRIB_STRIDE,
                    (int *)&bo->base.v0.stride);

   return &bo->base;

failed:
   free(mods_comp);
   free(mods_filtered);
   free(bo);
   return NULL;
}
```

DRI image 並不決定底層 storage type； `kms_swrast` 與 softpipe 的組合仍可能在更下層使用 DRM dumb BO。 以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri2.c:947`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri2.c#L947-1038)，用來追蹤 DRI image use 如何轉成 Gallium bind flags，再透過 resource template 進入 `pipe_screen::resource_create()`：

```c
struct dri_image *
dri_create_image(struct dri_screen *screen,
                 int width, int height,
                 int format,
                 const uint64_t *modifiers,
                 const unsigned _count,
                 unsigned int use,
                 void *loaderPrivate)
{
   ...
   if (use & __DRI_IMAGE_USE_SCANOUT)
      tex_usage |= PIPE_BIND_SCANOUT;
   ...

   memset(&templ, 0, sizeof(templ));
   templ.bind = tex_usage;
   templ.format = map->pipe_format;
   templ.target = PIPE_TEXTURE_2D;
   templ.width0 = width;
   templ.height0 = height;
   ...

   if (modifiers)
      img->texture =
         screen->base.screen->resource_create_with_modifiers(
            screen->base.screen, &templ, modifiers, count);
   else
      img->texture =
         screen->base.screen->resource_create(screen->base.screen, &templ);
   ...
}
```

Softpipe 收到帶有 `PIPE_BIND_SCANOUT` 的 resource template 後，必須在一般 heap storage 與軟體 display target 間分流。 以下兩段程式碼來自 [`Mesa: src/gallium/drivers/softpipe/sp_texture.c:130`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L130-195)，用來確認 scanout resource 如何進入 `winsys->displaytarget_create()`：

```c
// [Mesa: src/gallium/drivers/softpipe/sp_texture.c:130]
static bool
softpipe_displaytarget_layout(struct pipe_screen *screen,
                              struct softpipe_resource *spr,
                              const void *map_front_private)
{
   struct sw_winsys *winsys = softpipe_screen(screen)->winsys;

   spr->dt = winsys->displaytarget_create(winsys,
                                          spr->base.bind,
                                          spr->base.format,
                                          spr->base.width0,
                                          spr->base.height0,
                                          64,
                                          map_front_private,
                                          &spr->stride[0]);

   return spr->dt != NULL;
}

...

// [Mesa: src/gallium/drivers/softpipe/sp_texture.c:155]
static struct pipe_resource *
softpipe_resource_create_front(struct pipe_screen *screen,
                               const struct pipe_resource *templat,
                               const void *map_front_private)
{
   struct softpipe_resource *spr = CALLOC_STRUCT(softpipe_resource);
   ...
   spr->base = *templat;
   ...

   if (spr->base.bind & (PIPE_BIND_DISPLAY_TARGET |
                         PIPE_BIND_SCANOUT |
                         PIPE_BIND_SHARED)) {
      if (!softpipe_displaytarget_layout(screen, spr, map_front_private))
         goto fail;
   }
   else {
      if (!softpipe_resource_layout(screen, spr, true))
         goto fail;
   }

   return &spr->base;
   ...
}
```

在 `kms_swrast` 使用的 `kms-dri` winsys 中，display target factory 才是 image 分支的 `DRM_IOCTL_MODE_CREATE_DUMB` 呼叫端。 以下程式碼來自 [`Mesa: src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c:165`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c#L165-223)，用來確認 `kms_sw_displaytarget_create()` 如何建立並保存底層 dumb BO：

```c
static struct sw_displaytarget *
kms_sw_displaytarget_create(struct sw_winsys *ws,
                            unsigned tex_usage,
                            enum pipe_format format,
                            unsigned width, unsigned height,
                            unsigned alignment,
                            const void *front_private,
                            unsigned *stride)
{
   struct kms_sw_winsys *kms_sw = kms_sw_winsys(ws);
   struct kms_sw_displaytarget *kms_sw_dt;
   struct drm_mode_create_dumb create_req;
   ...

   memset(&create_req, 0, sizeof(create_req));
   create_req.bpp = util_format_get_blocksizebits(format);
   create_req.width = width;
   create_req.height = height;
   ret = drmIoctl(kms_sw->fd,
                  DRM_IOCTL_MODE_CREATE_DUMB, &create_req);
   if (ret)
      goto free_bo;

   kms_sw_dt->size = create_req.size;
   kms_sw_dt->handle = create_req.handle;
   ...
   *stride = create_req.pitch;
   return sw_displaytarget(plane);
   ...
}
```

Image 分支的 mapping 會經過 DRI image 與 Gallium resource，而不是取用 `gbm_dri_bo::map`

以下片段分別來自 [`Mesa: src/gallium/drivers/softpipe/sp_texture.c:296`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_texture.c#L296-384) 與 [`Mesa: src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c:312`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c#L312-350)，用來追蹤 resource mapping 如何經由軟體 transfer 與 winsys，最後抵達 DRM dumb mapping：

```c
// [Mesa: src/gallium/drivers/softpipe/sp_texture.c:296]
static void *
softpipe_transfer_map(struct pipe_context *pipe,
                      struct pipe_resource *resource,
                      unsigned level,
                      unsigned usage,
                      const struct pipe_box *box,
                      struct pipe_transfer **transfer)
{
   ...
   if (spr->dt)
      map = winsys->displaytarget_map(winsys, spr->dt, usage);
   else
      map = spr->data;
   ...
   return map + spt->offset;
}

...

// [Mesa: src/gallium/winsys/sw/kms-dri/kms_dri_sw_winsys.c:312]
static void *
kms_sw_displaytarget_map(struct sw_winsys *ws,
                         struct sw_displaytarget *dt,
                         unsigned flags)
{
   ...
   memset(&map_req, 0, sizeof map_req);
   map_req.handle = kms_sw_dt->handle;
   ret = drmIoctl(kms_sw->fd,
                  DRM_IOCTL_MODE_MAP_DUMB, &map_req);
   if (ret)
      goto fail_locked;
   ...
   if (*ptr == MAP_FAILED) {
      void *tmp = mmap(NULL, kms_sw_dt->size, prot, MAP_SHARED,
                       kms_sw->fd, map_req.offset);
      ...
      *ptr = tmp;
   }
   ...
   return *ptr + plane->offset;
}
```

DRI image handle 仍是 backend 對本地 storage 的 handle，不是 dma-buf fd，也不能直接拿到另一個 DRM file 使用。 需要匯出時，呼叫端必須經 `gbm_bo_get_fd*()` 取得 fd，並連同 plane、offset、stride、format 與 modifier metadata 一起傳遞。 對本文而言，direct dumb 與 DRI image／`kms_swrast` 是兩種都符合現有觀察的 source-level 解釋； 若要斷定實際執行採用哪一條，還需要記錄成功的 usage candidate 或對應的執行期 trace

#### Surface 只保存組態，Xorg 另行直接建立 BO

`gbm_surface_create()` 與 BO create 是兩條獨立路徑。 以下程式碼來自 [`Mesa: src/gbm/backends/dri/gbm_dri.c:1135`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gbm/backends/dri/gbm_dri.c#L1135) 的 `gbm_dri_surface_create()`，用來確認 surface wrapper 保存哪些組態、如何取得 modifier 陣列 ownership，以及記憶體配置失敗時如何清理：

```c
static struct gbm_surface *
gbm_dri_surface_create(struct gbm_device *gbm,
                       uint32_t width,
                       uint32_t height,
                       uint32_t format,
                       uint32_t flags,
                       const uint64_t *modifiers,
                       const unsigned count)
{
   ...
   surf->base.gbm = gbm;
   surf->base.v0.width = width;
   surf->base.v0.height = height;
   surf->base.v0.format = core->v0.format_canonicalize(format);
   surf->base.v0.flags = flags;
   if (!modifiers) {
      assert(!count);
      return &surf->base;
   }

   surf->base.v0.modifiers = calloc(count, sizeof(*modifiers));
   if (count && !surf->base.v0.modifiers) {
      errno = ENOMEM;
      free(surf);
      return NULL;
   }

   /* TODO: We are deferring validation of modifiers until the image is actually
    * created. This deferred creation can fail due to a modifier-format
    * mismatch. The result is the client has a surface but no object to back it.
    */
   surf->base.v0.count = count;
   memcpy(surf->base.v0.modifiers, modifiers, count * sizeof(*modifiers));

   return &surf->base;
}
```

沒有 modifier 時，函式保存基本組態後立即回傳。 有候選清單時，surface 複製陣列並擁有副本，destroy 時再釋放。 註解提到 image 日後真正建立時才驗證 modifier，但這個函式本身沒有建立 image，也沒有指定哪個整合層負責該動作。 因此本路徑的 completion 只到 surface 組態已保存

Xorg modesetting 另有一條直接建立 BO 的路徑。 [`Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:142`](https://github.com/X11Libre/xserver/blob/a6a8bc9464f7d787e91f63957357547e7c85c81f/hw/xfree86/drivers/video/modesetting/drmmode_bo.c#L142) 的 `gbm_bo_create_and_map()` 直接接收 GBM device、尺寸、format、modifier 與 flags，依序嘗試 `gbm_bo_create_with_modifiers2()`、相容介面與一般 `gbm_bo_create()`。 這段 Xorg 程式碼沒有先建立或消費 `gbm_surface`

```callgraph
GBM 公開呼叫端與 DRI backend
=================================================
GBM userspace 呼叫端
  │
  ├─ surface 組態路徑
  │    ↓
  │  [Mesa: src/gbm/main/gbm.c:660] gbm_surface_create(gbm, width, height, format, flags)
  │    └─ [Mesa: src/gbm/backends/dri/gbm_dri.c:1102] gbm_dri_surface_create(...)
  │         ├─ 配置失敗：`return NULL`
  │         └─ 成功：保存 width／height／format／flags 與 modifier 候選
  │              // 最終結果：`gbm_surface` 只擁有組態與 modifier 副本，不擁有 BO queue
  │
  └─ Xorg modesetting BO 配置路徑
       ↓
     [Xorg: hw/xfree86/drivers/video/modesetting/drmmode_bo.c:142] gbm_bo_create_and_map(...)
       ├─ modifier 候選存在：`gbm_bo_create_with_modifiers2(...)`
       ├─ modifier 路徑失敗：改試相容介面或 `gbm_bo_create(...)`
       └─ [Mesa: src/gbm/main/gbm.c:527] gbm_bo_create_with_modifiers2(...)
            ├─ 尺寸或 modifier／flags 組合無效：`errno = EINVAL; return NULL`
            └─ `gbm->v0.bo_create(..., modifiers, count)`
                 ↓
               [Mesa: src/gbm/backends/dri/gbm_dri.c:886] gbm_dri_bo_create(...)
                 ├─ `GBM_BO_USE_WRITE` 或不支援 dma-buf export
                 │    └─ `create_dumb(...)`
                 │         ├─ 建立／mapping 失敗：銷毀 handle 並釋放 wrapper
                 │         └─ 成功：`gbm_bo` 持有 mapped dumb BO state
                 └─ 其他 usage／capability
                      └─ [Mesa: gbm_dri.c:1015] dri_create_image_with_modifiers(...)
                           ├─ DRI image 配置失敗：釋放 wrapper 與 modifier 陣列
                           └─ 成功：`gbm_bo` 持有已配置的 DRI image
```

DRI surface 管理組態與 modifier 副本，GBM BO 則管理一份實際 storage，可能是 mapped dumb BO，也可能是 DRI image。 Xorg 的 BO factory 直接建立 `gbm_bo`。 這條 DRI surface 路徑沒有建立 image，也沒有保存或管理 BO queue

## VirGL guest driver 與 winsys

現在將同一個 `glxgears` 視窗從 2D drisw 基準路徑切換成 3D VirGL。 Application 仍然建立 X11 Window、GLX context 並送出相同的 OpenGL rendering，使用者也仍看到齒輪轉動。 改變的是 Mesa 區域內接住 Gallium callbacks 的 driver，以及真正執行 rendering 的位置

VirGL guest driver 會把齒輪這一幀的 Gallium resources、shader state 與 draw 編成 VirGL command stream，winsys 再準備 DRM BO handle list 與 fence information，最後以 `DRM_IOCTL_VIRTGPU_EXECBUFFER` 跨進 DRM／kernel。 Resource handle、GEM BO handle、DRM file context 與 Gallium context 分屬不同 namespaces 與生命週期，因此本章會沿 screen 建立、capset、context、resource、command encoding、transfer queue、submit 與 fence，逐步確認每次交出的實際 object

先把這項改變放回前面的 2D 基準案例。 軟體 rendering 會先產生 completed pixels，再由 display 路徑發布內容

VirGL 則在 rendering 階段產生 encoded renderer work、resource references 與 fence，交由後面的 guest winsys 提交

![virtio-gpu 2D 與 VirGL 3D 的結果比較：completed pixels 對 renderer work](./image/virtio-gpu-2d-3d-result.png)

相同的 Application、OpenGL frontend、State Tracker 與 Gallium contract 會一路走到 driver callback。 callback 之後，各條路徑才改用不同的 execution owner、resource backing 與 completion primitive

Guest Mesa trace 會先追到 ioctl UAPI。 接著再從 VMM 擁有的呼叫端開始，沿 virglrenderer 公開 API 觀察 host 如何承接同一份 renderer work

### 從 DRI driver selection 建立 VirGL screen

DRI frontend 取得 DRM driver 名稱後，會透過 Gallium driver descriptor 找到 screen factory。 對 virtio-gpu 而言，這個 factory 串起 `virgl_drm_screen_create()`、DRM winsys 與 `virgl_create_screen()`，最後仍回傳標準 `pipe_screen`。 這條建立鏈會決定成功時由哪個 screen 接手 winsys 與 duplicate fd，也會把失敗時的 teardown 邊界固定在對應的 factory 層

#### Driver descriptor 入口

`drm_driver_descriptor` 將 driver name、driconf 與 `create_screen` callback 放進同一份靜態描述。 pipe loader 依名稱選到 `virtio_gpu_driver_descriptor` 後，呼叫端不必知道後方是 VirGL，也不會直接呼叫 VirGL driver 內部函式

以下程式碼來自 [`Mesa: src/gallium/auxiliary/target-helpers/drm_helper.h:14`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/target-helpers/drm_helper.h#L14)，用來顯示 `DEFINE_DRM_DRIVER_DESCRIPTOR` 將 driver token 字串化成 `driver_name`，並把 driconf table、count、`create_screen` callback 與選用尾端欄位組成靜態 descriptor

```c
#define DEFINE_DRM_DRIVER_DESCRIPTOR(descriptor_name, driver, _driconf, _driconf_count, func, ...) \
const struct drm_driver_descriptor descriptor_name = {         \
   .driver_name = #driver,                                     \
   .driconf = _driconf,                                        \
   .driconf_count = _driconf_count,                            \
   .create_screen = func,                                      \
   ##__VA_ARGS__                                               \
};
```

descriptor macro 將 token `virtio_gpu` 字串化成 driver name，並把 `pipe_virtio_gpu_create_screen` 存入 callback。 因此 loader 所使用的名稱仍是 kernel DRM driver 名稱，Gallium driver 的實際 screen factory 則由 descriptor 解決

以下程式碼來自 [`Mesa: src/gallium/auxiliary/target-helpers/drm_helper.h:259`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/auxiliary/target-helpers/drm_helper.h#L259)，用來顯示 `pipe_virtio_gpu_create_screen()` 將 fd 與 config 交給 `virgl_drm_screen_create()`，成功才套用 debug wrapper，`DRM_DRIVER_DESCRIPTOR` 同時註冊 `virtio_gpu` 名稱與 VirGL driconf

```c
#if defined(GALLIUM_VIRGL)
#include "virgl/drm/virgl_drm_public.h"
#include "virgl/virgl_public.h"

static struct pipe_screen *
pipe_virtio_gpu_create_screen(int fd, const struct pipe_screen_config *config)
{
   struct pipe_screen *screen = NULL;

   if (!screen)
      screen = virgl_drm_screen_create(fd, config);

   return screen ? debug_screen_wrap(screen) : NULL;
}

const driOptionDescription virgl_driconf[] = {
      #include "virgl/virgl_driinfo.h.in"
};
DRM_DRIVER_DESCRIPTOR(virtio_gpu, virgl_driconf, ARRAY_SIZE(virgl_driconf))
```

這個入口沒有自行配置 `virgl_screen`。 它將 fd 與 `pipe_screen_config` 交給 DRM winsys wrapper，成功後才套上 debug screen。 driconf 選項也隨 descriptor 提供，後續 `virgl_create_screen()` 才會讀取這些設定

#### DRM winsys 與 Gallium screen

`virgl_drm_screen_create()` 先以 DRM file description 為鍵查找既有 screen。 同一份 file description 可以增加 `virgl_screen` 的 refcount，不同 open file description 則各自複製 fd 並建立 winsys。 這項粒度與 capset context、GEM handle namespace 相符，並非單純依 `/dev/dri/cardX` 路徑共用

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1366`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1366)，用來顯示 `virgl_drm_screen_create()` 在 mutex 下依 fd 查 screen cache，命中就遞增 `refcnt`，未命中則複製 fd、建立 DRM winsys 與 VirGL screen，再將成功結果加入 hash table

```c
struct pipe_screen *
virgl_drm_screen_create(int fd, const struct pipe_screen_config *config)
{
   struct pipe_screen *pscreen = NULL;

   simple_mtx_lock(&virgl_screen_mutex);
   if (!fd_tab) {
      fd_tab = _mesa_hash_table_create(NULL, hash_fd, equal_fd);
      if (!fd_tab)
         goto unlock;
   }

   pscreen = util_hash_table_get(fd_tab, intptr_to_pointer(fd));
   if (pscreen) {
      virgl_screen(pscreen)->refcnt++;
   } else {
      struct virgl_winsys *vws;
      int dup_fd = os_dupfd_cloexec(fd);
      if (dup_fd < 0)
         goto unlock;

      vws = virgl_drm_winsys_create(dup_fd);
      if (!vws) {
         close(dup_fd);
         goto unlock;
      }

      pscreen = virgl_create_screen(vws, config);
      if (pscreen) {
         _mesa_hash_table_insert(fd_tab, intptr_to_pointer(dup_fd), pscreen);
...
      }
   }

unlock:
   simple_mtx_unlock(&virgl_screen_mutex);
   return pscreen;
}
```

新路徑先由 `virgl_drm_winsys_create()` 封裝 fd，再把 `virgl_winsys` 交給 `virgl_create_screen()`。 後者才配置 `virgl_screen`、保存 winsys pointer，並安裝 Gallium screen callbacks。 Winsys 建立失敗時，呼叫端會關閉複製的 fd。 Winsys 已建立、但 `virgl_create_screen()` 的 screen 配置失敗時，固定呼叫端沒有在這條分支銷毀 winsys 或關閉該 fd

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_screen.c:1015`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_screen.c#L1015)，用來顯示 `virgl_create_screen()` 保存 `vws`，註冊 context、front-buffer、fence、dma-buf 與 resource callbacks，接著呼叫 `vws->get_caps()`，但不接收其 `int` 回傳值。 無論查詢成功或失敗，函式都會繼續修正 `screen->caps` 中的 formats／renderer，再初始化 Gallium caps

```c
struct pipe_screen *
virgl_create_screen(struct virgl_winsys *vws,
                    const struct pipe_screen_config *config)
{
...
   screen->vws = vws;
   screen->base.get_name = virgl_get_name;
   screen->base.get_vendor = virgl_get_vendor;
   screen->base.get_screen_fd = virgl_screen_get_fd;
   screen->base.get_video_param = virgl_get_video_param;
   screen->base.is_format_supported = virgl_is_format_supported;
   screen->base.is_video_format_supported = virgl_is_video_format_supported;
   screen->base.destroy = virgl_destroy_screen;
   screen->base.context_create = virgl_context_create;
   screen->base.flush_frontbuffer = virgl_flush_frontbuffer;
   screen->base.get_timestamp = u_default_get_timestamp;
   screen->base.fence_reference = virgl_fence_reference;
   //screen->base.fence_signalled = virgl_fence_signalled;
   screen->base.fence_finish = virgl_fence_finish;
   screen->base.fence_get_fd = virgl_fence_get_fd;
   screen->base.query_memory_info = virgl_query_memory_info;
   screen->base.get_disk_shader_cache = virgl_get_disk_shader_cache;
   screen->base.is_dmabuf_modifier_supported = virgl_is_dmabuf_modifier_supported;
   screen->base.get_dmabuf_modifier_planes = virgl_get_dmabuf_modifier_planes;

   virgl_init_screen_resource_functions(&screen->base);

   vws->get_caps(vws, &screen->caps);
   fixup_formats(&screen->caps.caps,
                 &screen->caps.caps.v2.supported_readback_formats);
   fixup_formats(&screen->caps.caps, &screen->caps.caps.v2.scanout);
   fixup_renderer(&screen->caps.caps);

   union virgl_caps *caps = &screen->caps.caps;
   screen->tweak_gles_emulate_bgra &= !virgl_format_check_bitmask(PIPE_FORMAT_B8G8R8A8_SRGB, caps->v1.render.bitmask, false);
   screen->refcnt = 1;

   virgl_init_shader_caps(screen);
...
}
```

`context_create` 指向 VirGL Gallium context factory，resource callbacks 由另一個初始化函式補齊。 Screen 會把 `screen->caps` 當時已有的內容整理成 Gallium shader、compute 與一般 caps，但不要求 winsys callback 先成功。 DRI frontend 最後只看見 `pipe_screen`，不會直接持有 `virgl_drm_winsys`

#### Winsys contract

`virgl_winsys` 是 driver 與平台實作之間的窄介面。 `virgl_cmd_buf` 只公開目前 dword 數與 buffer pointer，resource create 則接受 Gallium template 轉換後的 target、format、bind、尺寸與 flags。 DRM winsys 可以實作這組介面，測試用 winsys 也能採用相同 driver 上層

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_winsys.h:43`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_winsys.h#L43)，用來顯示 `struct virgl_winsys` 宣告 fence、encoded-transfer 與 coherent-memory capabilities，`resource_create` callback 則接收 VirGL format／bind、完整尺寸、flags 與 guest storage 所需大小

```c
struct virgl_cmd_buf {
   unsigned cdw;
   uint32_t *buf;
};

struct virgl_winsys {
   unsigned pci_id;
   int supports_fences; /* In/Out fences are supported */
   int supports_encoded_transfers; /* Encoded transfers are supported */
   int supports_coherent;          /* Coherent memory is supported */
...
   struct virgl_hw_res *(*resource_create)(struct virgl_winsys *vws,
                                           enum pipe_texture_target target,
                                           const void *map_front_private,
                                           uint32_t format, uint32_t bind,
                                           uint32_t width, uint32_t height,
                                           uint32_t depth, uint32_t array_size,
                                           uint32_t last_level, uint32_t nr_samples,
                                           uint32_t flags, uint32_t size);
...
```

對 command encoding 而言，winsys 提供 `emit_res` 與 `submit_cmd`。 前者在配置成功時，同時處理 command stream 中的 resource reference 與 kernel submission 所需的 object 追蹤，後者接收已編碼的 dword buffer。 `get_caps` 則反向把 renderer capability payload 提供給 screen 初始化

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_winsys.h:105`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_winsys.h#L105)，用來顯示 Winsys contract 以 `cmd_buf_create` 管理 command storage，`emit_res` 記錄 resource use，`submit_cmd` 交付 optional fence，`res_is_referenced` 查 hazard，`get_caps` 則填 renderer capabilities

```c
...
   bool (*resource_get_handle)(struct virgl_winsys *vws,
                               struct virgl_hw_res *res,
                               uint32_t stride,
                               struct winsys_handle *whandle);

   uint32_t (*resource_get_storage_size)(struct virgl_winsys* vws,
                                         struct virgl_hw_res* res);

   struct virgl_cmd_buf *(*cmd_buf_create)(struct virgl_winsys *ws, uint32_t size);
   void (*cmd_buf_destroy)(struct virgl_cmd_buf *buf);

   void (*emit_res)(struct virgl_winsys *vws, struct virgl_cmd_buf *buf, struct virgl_hw_res *res, bool write_buffer);
   int (*submit_cmd)(struct virgl_winsys *vws, struct virgl_cmd_buf *buf,
                     struct pipe_fence_handle **fence);

   bool (*res_is_referenced)(struct virgl_winsys *vws,
                             struct virgl_cmd_buf *buf,
                             struct virgl_hw_res *res);

   int (*get_caps)(struct virgl_winsys *vws, struct virgl_drm_caps *caps);
...
```

這份 contract 沒有承諾 resource handle 與 BO handle 相同，也沒有要求每個 Gallium callback 立即提交 ioctl。 driver 只依介面建立 resource、寫入 command、附加 reference，DRM-specific 的 handle 清單與 ioctl 結構留在 winsys

```callgraph
Mesa Gallium pipe-loader
=================================================
[Mesa: src/gallium/auxiliary/target-helpers/drm_helper.h:13] DEFINE_DRM_DRIVER_DESCRIPTOR(...)
  │
  └─ `.create_screen = func`
       // `virtio_gpu_driver_descriptor` 將 DRM driver name 綁到 VirGL screen factory
  ↓
[Mesa: src/gallium/auxiliary/target-helpers/drm_helper.h:264] pipe_virtio_gpu_create_screen(fd, config)
  │
  ├─ `virgl_drm_screen_create(fd, config)` 失敗
  │    └─ `return NULL`
  └─ 成功
       └─ `debug_screen_wrap(screen)`
  ↓
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1366] virgl_drm_screen_create(fd, config)
  │
  ├─ fd table 已有同一 file description 的 screen
  │    └─ `virgl_screen(pscreen)->refcnt++`
  │
  └─ 尚未建立
       ├─ `dup_fd = os_dupfd_cloexec(fd)`
       │    └─ 失敗時回傳 `NULL`
       ├─ `vws = virgl_drm_winsys_create(dup_fd)`
       │    └─ 失敗時關閉 `dup_fd` 並回傳 `NULL`
       └─ [Mesa: src/gallium/drivers/virgl/virgl_screen.c:977] virgl_create_screen(vws, config)
            ├─ screen 配置失敗：回傳 `NULL`
            │    // 呼叫端此時沒有銷毀已建立的 `vws`，也沒有關閉 `dup_fd`
            └─ 成功：將 `pipe_screen` 加入 fd table，並接管 winsys／`dup_fd` 的後續生命週期
```

### Context 與 capset

VirGL screen 建立期間會先處理 DRM file context 與 renderer capset，application 建立 OpenGL context 時才會再要求 Gallium `pipe_context`。 前者決定這份 DRM file 使用哪個 capset，後者保存每個 rendering context 的 command buffer、state 與 callbacks。 Capset 結果會限制後續 resource 與 transfer 功能，context teardown 則必須釋放 command buffer、transfer queue 與各項 context-owned references

#### DRM file context／capset 初始化

DRM winsys 先逐一查詢 virtio-gpu GETPARAM。 `VIRTGPU_PARAM_3D_FEATURES` 不存在時不建立 VirGL winsys，version 與 `CONTEXT_INIT` 支援也在同一階段判斷。 這些值描述 fd 背後的 guest kernel UAPI 能力，尚未建立 Gallium `pipe_context`

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1225`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1225)，用來顯示 `virgl_drm_winsys_create()` 逐項以 `DRM_IOCTL_VIRTGPU_GETPARAM` 填 `params`，缺少 3D features 或有效 DRM version 就回傳 NULL，kernel 支援 context init 時另要求 `virgl_init_context()` 成功

```c
static struct virgl_winsys *
virgl_drm_winsys_create(int drmFD)
{
   static const unsigned CACHE_TIMEOUT_USEC = 1000000;
   struct virgl_drm_winsys *qdws;
   int drm_version;
   int ret;

   for (uint32_t i = 0; i < ARRAY_SIZE(params); i++) {
      struct drm_virtgpu_getparam getparam = { 0 };
      uint64_t value = 0;
      getparam.param = params[i].param;
      getparam.value = (uint64_t)(uintptr_t)&value;
      ret = drmIoctl(drmFD, DRM_IOCTL_VIRTGPU_GETPARAM, &getparam);
      params[i].value = (ret == 0) ? value : 0;
   }

   if (!params[param_3d_features].value)
      return NULL;

   drm_version = virgl_drm_get_version(drmFD);
   if (drm_version < 0)
      return NULL;

   if (params[param_context_init].value) {
      ret = virgl_init_context(drmFD);
      if (ret)
         return NULL;
   }
...
}
```

kernel 支援 explicit context 初始化時，`virgl_init_context()` 從 supported capset bitmask 選擇 VirGL 2，否則退回 VirGL 1，並以 `DRM_IOCTL_VIRTGPU_CONTEXT_INIT` 設到這份 DRM file context。 函式參數只有 fd，程式也沒有配置 `struct virgl_context`

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1176`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1176)，用來顯示 `virgl_init_context()` 從 supported capset bitmask 優先選 VirGL 2、否則選 VirGL 1，兩者都不存在時回傳 `-EINVAL`，選定值則以 `DRM_IOCTL_VIRTGPU_CONTEXT_INIT` 寫入 file context

```c
static int virgl_init_context(int drmFD)
{
   int ret;
   struct drm_virtgpu_context_init init = { 0 };
   struct drm_virtgpu_context_set_param ctx_set_param = { 0 };
   uint64_t supports_capset_virgl, supports_capset_virgl2;
   supports_capset_virgl = supports_capset_virgl2 = 0;

   supports_capset_virgl = ((1 << VIRTGPU_DRM_CAPSET_VIRGL) &
                             params[param_supported_capset_ids].value);

   supports_capset_virgl2 = ((1 << VIRTGPU_DRM_CAPSET_VIRGL2) &
                              params[param_supported_capset_ids].value);

   if (!supports_capset_virgl && !supports_capset_virgl2) {
      _debug_printf("No virgl contexts available on host");
      return -EINVAL;
   }

   ctx_set_param.param = VIRTGPU_CONTEXT_PARAM_CAPSET_ID;
   ctx_set_param.value = (supports_capset_virgl2) ?
                         VIRTGPU_DRM_CAPSET_VIRGL2 :
                         VIRTGPU_DRM_CAPSET_VIRGL;

   init.ctx_set_params = (unsigned long)(void *)&ctx_set_param;
   init.num_params = 1;

   ret = drmIoctl(drmFD, DRM_IOCTL_VIRTGPU_CONTEXT_INIT, &init);
...
}
```

這裡的 context 由 kernel 依 open file description 管理。 同一 fd 在 compositor 先做其他 DRM 操作後可能得到 `EEXIST`，程式將其視為可接受的結果。 它的角色是建立 capset 選擇與 DRM submission 的 file-level 環境，並不承載 framebuffer、shader binding 或 draw state

#### Renderer capability query

完成 file context 初始化後，screen 仍要取得 renderer 支援的 formats、GLSL level、shader stage 與 feature bits。 以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1008`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1008)，用來追蹤 winsys 如何選擇 capset、退回 v1，以及各種失敗如何回傳給 `virgl_create_screen()`

```c
static int virgl_drm_get_caps(struct virgl_winsys *vws,
                              struct virgl_drm_caps *caps)
{
   struct virgl_drm_winsys *vdws = virgl_drm_winsys(vws);
   struct drm_virtgpu_get_caps args;
   int ret;

   virgl_ws_fill_new_caps_defaults(caps);

   memset(&args, 0, sizeof(args));
   if (params[param_capset_fix].value) {
      /* if we have the query fix - try and get cap set id 2 first */
      args.cap_set_id = 2;
      args.size = sizeof(union virgl_caps);
   } else {
      args.cap_set_id = 1;
      args.size = sizeof(struct virgl_caps_v1);
   }
   args.addr = (unsigned long)&caps->caps;

   ret = drmIoctl(vdws->fd, DRM_IOCTL_VIRTGPU_GET_CAPS, &args);
   if (ret == -1 && errno == EINVAL) {
      /* Fallback to v1 */
      args.cap_set_id = 1;
      args.size = sizeof(struct virgl_caps_v1);
      ret = drmIoctl(vdws->fd, DRM_IOCTL_VIRTGPU_GET_CAPS, &args);
      if (ret == -1)
          return ret;
   }
   return ret;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_screen.c:1035`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_screen.c#L1035)，用來追蹤 `DRM_IOCTL_VIRTGPU_GET_CAPS` 的結果如何整理成 Gallium screen 對上游公開的 capabilities

```c
struct pipe_screen *
virgl_create_screen(struct virgl_winsys *vws,
                    const struct pipe_screen_config *config)
{
...
   virgl_init_screen_resource_functions(&screen->base);

   vws->get_caps(vws, &screen->caps);
   fixup_formats(&screen->caps.caps,
                 &screen->caps.caps.v2.supported_readback_formats);
   fixup_formats(&screen->caps.caps, &screen->caps.caps.v2.scanout);
   fixup_renderer(&screen->caps.caps);

   union virgl_caps *caps = &screen->caps.caps;
   screen->tweak_gles_emulate_bgra &= !virgl_format_check_bitmask(PIPE_FORMAT_B8G8R8A8_SRGB, caps->v1.render.bitmask, false);
   screen->refcnt = 1;

   virgl_init_shader_caps(screen);
   virgl_init_compute_caps(screen);
   virgl_init_screen_caps(screen);
...
}
```

`DRM_IOCTL_VIRTGPU_GET_CAPS` 將結果寫進 `union virgl_caps`。 Screen 隨後修正 format bitmask 與 renderer 欄位，再初始化 shader、compute 與一般 capabilities。 Gallium frontend 只會看見整理過的 `pipe_screen` capability，不必理解 GET_CAPS 的版本退回

GET_CAPS 失敗不會沿這條路徑使 `virgl_create_screen()` 回傳 `NULL`。 `virgl_drm_get_caps()` 雖然回傳錯誤，呼叫端卻直接丟棄該值，仍以 `screen->caps` 當時的既有內容繼續執行。 新版欄位沿用 callback 在 ioctl 前寫入的 defaults，其餘內容則維持 screen 的零初始化值或 ioctl 回傳前已留下的值。 固定實作沒有針對這個錯誤執行 screen 失敗 unwind

#### Gallium rendering context

`virgl_context_create()` 由 `pipe_screen.context_create` 呼叫，每次都建立新的 Gallium rendering context，不再呼叫 `DRM_IOCTL_VIRTGPU_CONTEXT_INIT` 或重新選擇 capset。 以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1709`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1709)，用來檢查 context 與 command buffer 的配置順序及其失敗路徑

```c
struct pipe_context *virgl_context_create(struct pipe_screen *pscreen,
                                          void *priv,
                                          unsigned flags)
{
   struct virgl_context *vctx;
   struct virgl_screen *rs = virgl_screen(pscreen);
   vctx = CALLOC_STRUCT(virgl_context);
   const char *host_debug_flagstring;

   vctx->cbuf = rs->vws->cmd_buf_create(rs->vws, VIRGL_MAX_CMDBUF_DWORDS);
   if (!vctx->cbuf) {
      FREE(vctx);
      return NULL;
   }

   vctx->base.destroy = virgl_context_destroy;
   vctx->base.set_framebuffer_state = virgl_set_framebuffer_state;
   vctx->base.create_blend_state = virgl_create_blend_state;
   vctx->base.bind_blend_state = virgl_bind_blend_state;
   vctx->base.delete_blend_state = virgl_delete_blend_state;
   vctx->base.create_depth_stencil_alpha_state = virgl_create_depth_stencil_alpha_state;
   vctx->base.bind_depth_stencil_alpha_state = virgl_bind_depth_stencil_alpha_state;
   vctx->base.delete_depth_stencil_alpha_state = virgl_delete_depth_stencil_alpha_state;
   vctx->base.create_rasterizer_state = virgl_create_rasterizer_state;
   vctx->base.bind_rasterizer_state = virgl_bind_rasterizer_state;
   vctx->base.delete_rasterizer_state = virgl_delete_rasterizer_state;
...
}
```

`CALLOC_STRUCT(virgl_context)` 的結果沒有先經過空值檢查，下一行便透過 `vctx->cbuf` 解參照。 只有 command buffer 建立失敗時，函式才會釋放已建立的 context 並回傳 `NULL`

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1736`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1736)，用來觀察同一個 factory 如何把各類 rendering callbacks 安裝到 `vctx->base`

```c
struct pipe_context *
virgl_context_create(struct pipe_screen *pscreen,
                     void *priv,
                     unsigned flags)
{
...
   vctx->base.set_viewport_states = virgl_set_viewport_states;
   vctx->base.create_vertex_elements_state = virgl_create_vertex_elements_state;
   vctx->base.bind_vertex_elements_state = virgl_bind_vertex_elements_state;
   vctx->base.delete_vertex_elements_state = virgl_delete_vertex_elements_state;
   vctx->base.set_vertex_buffers = virgl_set_vertex_buffers;
   vctx->base.set_constant_buffer = virgl_set_constant_buffer;

   vctx->base.set_tess_state = virgl_set_tess_state;
   vctx->base.set_patch_vertices = virgl_set_patch_vertices;
   vctx->base.create_vs_state = virgl_create_vs_state;
   vctx->base.create_tcs_state = virgl_create_tcs_state;
   vctx->base.create_tes_state = virgl_create_tes_state;
   vctx->base.create_gs_state = virgl_create_gs_state;
   vctx->base.create_fs_state = virgl_create_fs_state;

   vctx->base.bind_vs_state = virgl_bind_vs_state;
   vctx->base.bind_tcs_state = virgl_bind_tcs_state;
   vctx->base.bind_tes_state = virgl_bind_tes_state;
   vctx->base.bind_gs_state = virgl_bind_gs_state;
   vctx->base.bind_fs_state = virgl_bind_fs_state;

   vctx->base.delete_vs_state = virgl_delete_vs_state;
   vctx->base.delete_tcs_state = virgl_delete_tcs_state;
   vctx->base.delete_tes_state = virgl_delete_tes_state;
   vctx->base.delete_gs_state = virgl_delete_gs_state;
   vctx->base.delete_fs_state = virgl_delete_fs_state;
...
}
```

建立後的 `vctx->base` 形成 per-rendering-context dispatch table。 每份 Gallium context 可以累積自己的 command dwords、shader binding、vertex array dirty state 與 object handles，底下仍共用 screen 所持有的 winsys 與 DRM file context

兩個 context 名稱的差異可用建立位置判斷。 `virgl_init_context()` 出現在 DRM winsys 建立流程，輸出是 ioctl 對 fd state 的修改。 `virgl_context_create()` 出現在 Gallium screen callback，輸出是 `struct pipe_context *`。 後者可以建立多次，前者依 DRM file 初始化條件處理

```callgraph
Mesa VirGL DRM winsys 初始化
=================================================
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1225] virgl_drm_winsys_create(drmFD)
  │
  ├─ 對每個 `params[i]`
  │    └─ `drmIoctl(drmFD, DRM_IOCTL_VIRTGPU_GETPARAM, &getparam)`
  │         // 保存 3D features、context init 與 capset support
  │
  ├─ 若 `param_3d_features == 0`
  │    └─ `return NULL`
  │
  └─ 若 kernel 支援 context init
       └─ [Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1176] virgl_init_context(drmFD)
            ├─ 若 virgl 與 virgl2 capset 都不可用，`return -EINVAL`
            ├─ 優先選 `VIRTGPU_DRM_CAPSET_VIRGL2`
            └─ `DRM_IOCTL_VIRTGPU_CONTEXT_INIT`
                 // 最終結果：成功的 winsys 保存 fd-level feature／capset state

Mesa VirGL screen capability stage
=================================================
[Mesa: src/gallium/drivers/virgl/virgl_screen.c:977] virgl_create_screen(vws, config)
  │
  ├─ `screen = CALLOC_STRUCT(virgl_screen)` 失敗
  │    └─ `return NULL`
  │
  └─ [Mesa: src/gallium/drivers/virgl/virgl_screen.c:1037] `vws->get_caps(vws, &screen->caps)`
       ↓
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1008] virgl_drm_get_caps(vws, caps)
  │
  ├─ 若 capset-fix 可用，先查 capset 2
  │    └─ `DRM_IOCTL_VIRTGPU_GET_CAPS`
  ├─ 若 ioctl 以 `EINVAL` 失敗
  │    └─ 改查 capset 1
  └─ ioctl 失敗：向呼叫端回傳 `-1`
       // `virgl_create_screen()` 不接回傳值，仍修正既有 caps、初始化 Gallium caps 並回傳 screen

後續 `pipe_screen::context_create` 階段
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1709] virgl_context_create(screen, priv, flags)
  │
  ├─ `vctx = CALLOC_STRUCT(virgl_context)` 失敗
  │    └─ 下一行仍解參照 `vctx->cbuf`
  │         // unchecked 配置 OOM，沒有受控的 `NULL` 回傳路徑
  ├─ `vctx->cbuf = rs->vws->cmd_buf_create(...)` 失敗
  │    └─ `FREE(vctx)`，回傳 `NULL`
  └─ 成功
       └─ `pipe_context` 持有 `virgl_cmd_buf`、capability-derived callbacks 與 transfer queue
```

### Resource create、classic resource 與 blob

VirGL screen 與 rendering context 建立完成後，application 便能開始準備 vertex buffer、texture 與 render target。 當 OpenGL frontend 定義這些 storage 時，State Tracker 會把需求轉成 Gallium resource template； 這份 template 只描述尺寸、format 與用途，還不是一份可以 map、傳送或提交的實際 resource

VirGL driver 接下來必須算出各層的 stride、offset 與總大小，再請 winsys 找到可重用的 storage，或建立新的 virtio-gpu resource。 這個建立結果會影響後面的 map、transfer、command reference 與 teardown，因此要先看 classic resource 與 blob resource 如何分流

#### Gallium resource layout 與 winsys handoff

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:600`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L600)，用來觀察 texture target、mipmap level、format block size 與 array slices 如何決定 guest resource 的 layout

```c
static void virgl_resource_layout(struct pipe_resource *pt,
                                  struct virgl_resource_metadata *metadata,
                                  uint32_t plane,
                                  uint32_t winsys_stride,
                                  uint32_t plane_offset,
                                  uint64_t modifier)
{
   unsigned level, nblocksy;
   unsigned width = pt->width0;
   unsigned height = pt->height0;
   unsigned depth = pt->depth0;
   unsigned buffer_size = 0;

   for (level = 0; level <= pt->last_level; level++) {
      unsigned slices;

      if (pt->target == PIPE_TEXTURE_CUBE)
         slices = 6;
      else if (pt->target == PIPE_TEXTURE_3D)
         slices = depth;
      else
         slices = pt->array_size;

      nblocksy = util_format_get_nblocksy(pt->format, height);
      metadata->stride[level] = winsys_stride ? winsys_stride :
                                util_format_get_stride(pt->format, width);
      metadata->layer_stride[level] = nblocksy * metadata->stride[level];
      metadata->level_offset[level] = buffer_size;

      buffer_size += slices * metadata->layer_stride[level];
...
   }
   ...
}
```

`virgl_resource_layout()` 計算出的 stride、layer stride、level offset 與總大小留在 guest driver 的 `virgl_resource`，供後續操作解讀同一份 storage

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:754`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L754)，用來追蹤 driver 如何從 resource layout 與用途決定 guest storage 所需大小，再把需求交給 winsys

```c
static struct pipe_resource *
virgl_resource_create_front(struct pipe_screen *screen,
                            const struct pipe_resource *templ,
                            const void *map_front_private)
{
...
   // If renderer supports copy transfer from host, and we either have support
   // for then for textures alloc minimum size of bo
   // This size is not passed to the host
   res->use_staging = virgl_can_copy_transfer_from_host(vs, res, vbind);

   if (res->use_staging)
      alloc_size = 1;
   else if (templ->bind & PIPE_BIND_SHARED)
      alloc_size = virgl_resource_shared_tex_size(res);
   else
      alloc_size = res->metadata.total_size;

   res->hw_res = vs->vws->resource_create(vs->vws, templ->target,
                                          map_front_private,
                                          templ->format, vbind,
                                          templ->width0,
                                          templ->height0,
                                          templ->depth0,
                                          templ->array_size,
                                          templ->last_level,
                                          templ->nr_samples,
                                          vflags,
                                          alloc_size);
...
}
```

winsys 回傳的 `virgl_hw_res` 存進 `res->hw_res`，Gallium resource 本體仍保存 template、reference 與 layout metadata。 因此一個 `pipe_resource` 同時有 frontend 可見的 format／尺寸、guest driver 的 layout，以及 winsys 管理的 kernel-facing object

#### Cache／配置分流

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/common/virgl_resource_cache.c:102`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/common/virgl_resource_cache.c#L102)，用來檢查 cache 如何判斷 resource 相容性、清理過期 entries，以及排除仍在使用中的 storage

```c
struct virgl_resource_cache_entry *
virgl_resource_cache_remove_compatible(struct virgl_resource_cache *cache,
                                       struct virgl_resource_params params)
{
   const int64_t now = os_time_get();
   struct virgl_resource_cache_entry *compat_entry = NULL;
   bool check_expired = true;

   /* Iterate through the cache to find a compatible resource, while also
    * destroying any expired resources we come across.
    */
   list_for_each_entry_safe(struct virgl_resource_cache_entry,
                            entry, &cache->resources, head) {
      const bool compatible =
         virgl_resource_cache_entry_is_compatible(entry, params);

      if (compatible) {
         if (!cache->entry_is_busy_func(entry, cache->user_data))
            compat_entry = entry;

         /* We either have found a compatible resource, in which case we are
          * done, or the resource is busy, which means resources later in
          * the cache list will also be busy, so there is no point in
          * searching further.
          */
         break;
      }
...
   }
   ...
   return compat_entry;
}
```

cache 不只比較 size。 Buffer 還要符合 bind、format、flags 與 target，texture 則比較完整的 `virgl_resource_params`。 找到相容且 idle 的 entry 後，cache 才會移出並重用它

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:435`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L435)，用來追蹤 cache miss 之後如何依 mapping flags 在 blob 與 classic resource 建立之間分流

```c
static struct virgl_hw_res *
virgl_drm_winsys_resource_cache_create(
   struct virgl_winsys *qws,
   enum pipe_texture_target target,
   const void *map_front_private,
   uint32_t format,
   uint32_t bind,
   uint32_t width,
   uint32_t height,
   uint32_t depth,
   uint32_t array_size,
   uint32_t last_level,
   uint32_t nr_samples,
   uint32_t flags,
   uint32_t size)
{
...
   if (!can_cache_resource(bind))
      goto alloc;

   mtx_lock(&qdws->mutex);

   entry = virgl_resource_cache_remove_compatible(&qdws->cache, params);
   if (entry) {
      res = cache_entry_container_res(entry);
      mtx_unlock(&qdws->mutex);
      pipe_reference_init(&res->reference, 1);
      return res;
   }
...
alloc:
   /* PIPE_BUFFER with VIRGL_BIND_CUSTOM flag will access data when attaching,
    * in order to avoid race conditions we need to treat it as busy during
    * creation
    */
   if (target == PIPE_BUFFER && (bind & VIRGL_BIND_CUSTOM))
       need_sync = true;

   if (flags & (VIRGL_RESOURCE_FLAG_MAP_PERSISTENT |
                VIRGL_RESOURCE_FLAG_MAP_COHERENT))
      res = virgl_drm_winsys_resource_create_blob(qws, target, format, bind,
                                                  width, height, depth,
                                                  array_size, last_level,
                                                  nr_samples, flags, size);
   else
      res = virgl_drm_winsys_resource_create(qws, target, format, bind, width,
                                             height, depth, array_size,
                                             last_level, nr_samples, size,
                                             need_sync);
   return res;
}
```

這個分流發生在 `virgl_winsys.resource_create` 實作內，上游 `virgl_resource_create_front()` 不會直接選 ioctl。 cache hit 也不產生新 `res_handle` 或 `bo_handle`，它重新取得既有 `virgl_hw_res` 的 ownership

#### Classic resource ioctl

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:248`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L248)，用來觀察 classic resource 路徑如何準備 stride 與 cache parameters

```c
static struct virgl_hw_res *
virgl_drm_winsys_resource_create(struct virgl_winsys *qws,
                                 enum pipe_texture_target target,
                                 uint32_t format,
                                 uint32_t bind,
                                 uint32_t width,
                                 uint32_t height,
                                 uint32_t depth,
                                 uint32_t array_size,
                                 uint32_t last_level,
                                 uint32_t nr_samples,
                                 uint32_t size,
                                 bool for_fencing)
{
   struct virgl_drm_winsys *qdws = virgl_drm_winsys(qws);
   struct drm_virtgpu_resource_create createcmd;
   int ret;
   struct virgl_hw_res *res;
   uint32_t stride = width * util_format_get_blocksize(format);
   struct virgl_resource_params params = { .size = size,
                                           .bind = bind,
                                           .format = format,
                                           .flags = 0,
                                           .nr_samples = nr_samples,
                                           .width = width,
                                           .height = height,
                                           .depth = depth,
                                           .array_size = array_size,
                                           .last_level = last_level,
                                           .target = target };
...
}
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:283`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L283)，用來追蹤 classic create ioctl 的失敗清理、兩種 resource handles 與初始 busy／cache state

```c
static struct virgl_hw_res *
virgl_drm_winsys_resource_create(
   struct virgl_winsys *qws,
   enum pipe_texture_target target,
   uint32_t format,
   uint32_t bind,
   uint32_t width,
   uint32_t height,
   uint32_t depth,
   uint32_t array_size,
   uint32_t last_level,
   uint32_t nr_samples,
   uint32_t size,
   bool for_fencing)
{
...
   memset(&createcmd, 0, sizeof(createcmd));
   createcmd.target = target;
   createcmd.format = pipe_to_virgl_format(format);
   createcmd.bind = bind;
   createcmd.width = width;
   createcmd.height = height;
   createcmd.depth = depth;
   createcmd.array_size = array_size;
   createcmd.last_level = last_level;
   createcmd.nr_samples = nr_samples;
   createcmd.stride = stride;
   createcmd.size = size;

   ret = drmIoctl(qdws->fd, DRM_IOCTL_VIRTGPU_RESOURCE_CREATE, &createcmd);
   if (ret != 0) {
      FREE(res);
      return NULL;
   }

   res->bind = bind;

   res->res_handle = createcmd.res_handle;
   res->bo_handle = createcmd.bo_handle;
...
   /* A newly created resource is considered busy by the kernel until the
    * command is retired.  But for our purposes, we can consider it idle
    * unless it is used for fencing.
    */
   p_atomic_set(&res->maybe_busy, for_fencing);

   virgl_resource_cache_entry_init(&res->cache_entry, params);
...
}
```

classic create 完成的是 guest kernel 能追蹤的 resource／BO pair。 Gallium resource 已取得 storage identity，但此時還沒有 draw command 引用它。 稍後 encoder 寫入 `res_handle` 時，winsys 才會同步建立該 command buffer 的 BO reference 清單

#### Blob resource ioctl

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:168`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L168)，用來觀察 blob resource 路徑如何準備 renderer command、ioctl arguments 與 cache parameters

```c
static struct virgl_hw_res *
virgl_drm_winsys_resource_create_blob(struct virgl_winsys *qws,
                                      enum pipe_texture_target target,
                                      uint32_t format,
                                      uint32_t bind,
                                      uint32_t width,
                                      uint32_t height,
                                      uint32_t depth,
                                      uint32_t array_size,
                                      uint32_t last_level,
                                      uint32_t nr_samples,
                                      uint32_t flags,
                                      uint32_t size)
{
   int ret;
   int32_t blob_id;
   uint32_t cmd[VIRGL_PIPE_RES_CREATE_SIZE + 1] = { 0 };
   struct virgl_drm_winsys *qdws = virgl_drm_winsys(qws);
   struct drm_virtgpu_resource_create_blob drm_rc_blob = { 0 };
   struct virgl_hw_res *res;
   struct virgl_resource_params params = { .size = size,
                                           .bind = bind,
                                           .format = format,
                                           .flags = flags,
                                           .nr_samples = nr_samples,
                                           .width = width,
                                           .height = height,
                                           .depth = depth,
                                           .array_size = array_size,
                                           .last_level = last_level,
                                           .target = target };
...
}
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:207`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L207)，用來追蹤 blob id 與 memory flags 如何進入 ioctl，以及成功與失敗路徑如何處理 resource wrapper

```c
static struct virgl_hw_res *
virgl_drm_winsys_resource_create_blob(
   struct virgl_winsys *qws,
   enum pipe_texture_target target,
   uint32_t format,
   uint32_t bind,
   uint32_t width,
   uint32_t height,
   uint32_t depth,
   uint32_t array_size,
   uint32_t last_level,
   uint32_t nr_samples,
   uint32_t flags,
   uint32_t size)
{
...
   blob_id = p_atomic_inc_return(&qdws->blob_id);
   cmd[0] = VIRGL_CMD0(VIRGL_CCMD_PIPE_RESOURCE_CREATE, 0, VIRGL_PIPE_RES_CREATE_SIZE);
   cmd[VIRGL_PIPE_RES_CREATE_FORMAT] = pipe_to_virgl_format(format);
   cmd[VIRGL_PIPE_RES_CREATE_BIND] = bind;
   cmd[VIRGL_PIPE_RES_CREATE_TARGET] = target;
   cmd[VIRGL_PIPE_RES_CREATE_WIDTH] = width;
   cmd[VIRGL_PIPE_RES_CREATE_HEIGHT] = height;
   cmd[VIRGL_PIPE_RES_CREATE_DEPTH] = depth;
   cmd[VIRGL_PIPE_RES_CREATE_ARRAY_SIZE] = array_size;
   cmd[VIRGL_PIPE_RES_CREATE_LAST_LEVEL] = last_level;
   cmd[VIRGL_PIPE_RES_CREATE_NR_SAMPLES] = nr_samples;
   cmd[VIRGL_PIPE_RES_CREATE_FLAGS] = flags;
   cmd[VIRGL_PIPE_RES_CREATE_BLOB_ID] = blob_id;

   drm_rc_blob.cmd = (unsigned long)(void *)&cmd;
   drm_rc_blob.cmd_size = 4 * (VIRGL_PIPE_RES_CREATE_SIZE + 1);
   drm_rc_blob.size = size;
   drm_rc_blob.blob_mem = VIRTGPU_BLOB_MEM_HOST3D;
   drm_rc_blob.blob_flags = VIRTGPU_BLOB_FLAG_USE_MAPPABLE;
   drm_rc_blob.blob_id = (uint64_t) blob_id;

   ret = drmIoctl(qdws->fd, DRM_IOCTL_VIRTGPU_RESOURCE_CREATE_BLOB, &drm_rc_blob);
   if (ret != 0) {
      FREE(res);
      return NULL;
   }

   res->bind = bind;
   res->res_handle = drm_rc_blob.res_handle;
   res->bo_handle = drm_rc_blob.bo_handle;
...
}
```

command 陣列描述 renderer resource，ioctl struct 則指定 blob memory、mappable flag、blob id 與 guest storage size。 ioctl 成功後，winsys 把 `res_handle` 與 `bo_handle` 存進同一個 `virgl_hw_res`

classic 與 blob 最終都產生 `virgl_hw_res`，所以 driver 上層不需要兩套 command encoding。 差異集中在配置方式、blob metadata 與可 map／coherent 能力。 兩條路徑也都證明 resource namespace 與 BO namespace 從建立時就分開存在

```callgraph
Mesa VirGL resource front-end
=================================================
[Mesa: src/gallium/drivers/virgl/virgl_resource.c:728] virgl_resource_create_front(screen, templ, map_front_private)
  │
  │  // 在這裡計算 `pipe_resource` 的 guest storage layout，再交給 winsys 配置 storage
  ├─ [Mesa: src/gallium/drivers/virgl/virgl_resource.c:600] virgl_resource_layout(&res->b, &metadata, ...)
  │    ├─ 逐 mip level 計算 `stride`、`layer_stride` 與 `level_offset`
  │    └─ 設定 `metadata.total_size`
  │
  └─ `vs->vws->resource_create(..., alloc_size)`
  ↓
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:435] virgl_drm_winsys_resource_cache_create(...)
  │
  ├─ 若 resource 可 cache 且找到 compatible、idle entry
  │    └─ 重設 reference 後回傳舊 `virgl_hw_res`
  │
  ├─ 若 flags 需要 persistent／coherent mapping
  │    └─ [Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:168] create_blob()
  │         ├─ `DRM_IOCTL_VIRTGPU_RESOURCE_CREATE_BLOB`
  │         └─ 失敗時釋放 wrapper 並回傳 `NULL`
  │
  └─ 其他 resource
       └─ [Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:248] create_classic()
            ├─ `DRM_IOCTL_VIRTGPU_RESOURCE_CREATE`
            └─ 失敗時釋放 wrapper 並回傳 `NULL`
  ↓
成功的 `virgl_hw_res`
  ├─ `res_handle`：command stream 中的 renderer resource identity
  └─ `bo_handle`：execbuffer BO list 中的 guest kernel identity
```

### Shader、resource state 與 draw command encoding

現在讓 application 設定 shader、vertex buffer、texture 與其他 rendering state，最後發出 draw 呼叫。 這些 OpenGL operation 進入 VirGL driver 時，不會各自立刻跨進 kernel； driver 需要先把它們整理成 renderer 能理解的 protocol commands

因此，這一階段要觀察 shader 與 state 在什麼時點取得 protocol identity、draw 前需要補上哪些尚未送出的 state，以及累積中的 command buffer 何時必須切批。 這也會說明 resource reference 為什麼要和 command bytes 一起保留到 submit

#### Shader encoding

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:750`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L750)，用來追蹤 TGSI transformation、shader object handle 配置與各個失敗 exits

```c
static void *
virgl_shader_encoder(struct pipe_context *ctx,
                     const struct pipe_shader_state *shader,
                     unsigned type)
{
...
   new_tokens = virgl_tgsi_transform(rs, tokens, is_separable);
   if (!new_tokens)
      return NULL;

   handle = virgl_object_assign_handle();
   /* encode VS state */
   ret = virgl_encode_shader_state(vctx, handle, type,
                                   &shader->stream_output, 0,
                                   new_tokens);
   if (ret) {
      FREE((void *)ntt_tokens);
      return NULL;
   }

   FREE((void *)ntt_tokens);
   FREE(new_tokens);
   return (void *)(uintptr_t)handle;

}
```

這段失敗處理並不完整。 NIR 路徑在呼叫 `virgl_tgsi_transform()` 前沒有檢查 `nir_to_tgsi_options()` 的結果。 transform 回傳 `NULL` 時沒有釋放 `ntt_tokens`，encoder 回傳非零值時則只釋放 `ntt_tokens`，沒有釋放 `new_tokens`。 只有成功路徑會同時執行 `FREE(ntt_tokens)` 與 `FREE(new_tokens)`

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:750`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L750)，用來觀察 TGSI tokens 如何轉成文字 command payload，以及暫存空間不足時如何擴張

```c
int virgl_encode_shader_state(struct virgl_context *ctx,
                              uint32_t handle,
                              mesa_shader_stage type,
                              const struct pipe_stream_output_info *so_info,
                              uint32_t cs_req_local_mem,
                              const struct tgsi_token *tokens)
{
   char *str, *sptr;
   uint32_t shader_len, len;
   bool bret;
   int num_tokens = tgsi_num_tokens(tokens);
   int str_total_size = 65536;
   int retry_size = 1;
   uint32_t left_bytes, base_hdr_size, strm_hdr_size, thispass;
   bool first_pass;
   str = CALLOC(1, str_total_size);
   if (!str)
      return -1;

   do {
      int old_size;

      bret = tgsi_dump_str(tokens, TGSI_DUMP_FLOAT_AS_HEX, str, str_total_size);
      if (bret == false) {
         if (virgl_debug & VIRGL_DEBUG_VERBOSE)
            debug_printf("Failed to translate shader in available space - trying again\n");
         old_size = str_total_size;
         str_total_size = 65536 * retry_size;
         retry_size *= 2;
         str = REALLOC(str, old_size, str_total_size);
         if (!str)
            return -1;
      }
   } while (bret == false && retry_size < 1024);
...
}
```

shader create callback 回傳的是以 `void *` 承載的 object handle，bind callback 之後再用相同 id 編碼 bind command。 shader 本身不以 `virgl_hw_res` 表示，只有 shader 讀寫的 buffer、image 與 sampler resource 需要 winsys resource reference

#### Vertex buffer 與 sampler view

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:575`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L575)，用來確認設定 vertex buffers 時保存哪些 references 與 dirty state，以及何時才會產生 protocol command

```c
static void virgl_set_vertex_buffers(struct pipe_context *ctx,
                                    unsigned num_buffers,
                                    const struct pipe_vertex_buffer *buffers)
{
   struct virgl_context *vctx = virgl_context(ctx);

   util_set_vertex_buffers_count(vctx->vertex_buffer,
                                 &vctx->num_vertex_buffers,
                                 buffers, num_buffers);

   if (buffers) {
      for (unsigned i = 0; i < num_buffers; i++) {
         struct virgl_resource *res =
            virgl_resource(buffers[i].buffer.resource);
         if (res && !buffers[i].is_user_buffer)
            res->bind_history |= PIPE_BIND_VERTEX_BUFFER;
      }
   }

   vctx->vertex_array_dirty = true;
}
```

設定 vertex buffers 只會更新 context state 並標記 `vertex_array_dirty`。 以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:950`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L950)，用來觀察 draw 前真正編碼 vertex-buffer state 時會寫入哪些欄位

```c
int virgl_encoder_set_vertex_buffers(struct virgl_context *ctx,
                                    unsigned num_buffers,
                                    const struct pipe_vertex_buffer *buffers)
{
   int i;
   virgl_encoder_write_cmd_dword(ctx, VIRGL_CMD0(VIRGL_CCMD_SET_VERTEX_BUFFERS, 0, VIRGL_SET_VERTEX_BUFFERS_SIZE(num_buffers)));
   for (i = 0; i < num_buffers; i++) {
      struct virgl_resource *res = virgl_resource(buffers[i].buffer.resource);
      virgl_encoder_write_dword(ctx->cbuf, ctx->vertex_elements ? ctx->vertex_elements->strides[i] : 0);
      virgl_encoder_write_dword(ctx->cbuf, buffers[i].buffer_offset);
      virgl_encoder_write_res(ctx, res);
   }
   return 0;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1130`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1130)，用來追蹤 sampler view 從 object 建立、texture reference 到 binding 時 resource attachment 的完整關係

```c
static struct pipe_sampler_view *virgl_create_sampler_view(struct pipe_context *ctx,
                                      struct pipe_resource *texture,
                                      const struct pipe_sampler_view *state)
{
   struct virgl_context *vctx = virgl_context(ctx);
   struct virgl_sampler_view *grview;
   uint32_t handle;
   struct virgl_resource *res;

   if (!state)
      return NULL;

   grview = CALLOC_STRUCT(virgl_sampler_view);
   if (!grview)
      return NULL;

   res = virgl_resource(texture);
   handle = virgl_object_assign_handle();
   virgl_encode_sampler_view(vctx, handle, res, state);

   grview->base = *state;
   grview->base.reference.count = 1;

   grview->base.texture = NULL;
   grview->base.context = ctx;
   pipe_resource_reference(&grview->base.texture, texture);
   grview->handle = handle;
   return &grview->base;
}

static void
virgl_set_sampler_views(struct pipe_context *ctx,
                        mesa_shader_stage shader_type,
                        unsigned start_slot,
                        unsigned num_views,
                        unsigned unbind_num_trailing_slots,
                        struct pipe_sampler_view **views)
{
...
   virgl_encode_set_sampler_views(vctx, shader_type,
         start_slot, num_views, (struct virgl_sampler_view **)binding->views);
   virgl_attach_res_sampler_views(vctx, shader_type);
...
}
```

vertex buffer 與 sampler view 呈現兩種 state 節奏。 vertex state 延後到 draw 前編碼，sampler view object 在建立時編碼、binding 在 set 時編碼。 兩者引用的 storage 都經 `emit_res`，正常配置時遵循相同的 renderer handle／kernel BO list 更新規則。 handle-list 配置失敗則是兩種 state 都會遇到的共同例外

#### Draw callback 與 encoded command

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1011`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1011)，用來追蹤 Gallium `draw_vbo` callback 如何處理空 draw 與 multi-draw，再補齊 resource state 並交給 encoder

```c
static void virgl_draw_vbo(struct pipe_context *ctx,
                           const struct pipe_draw_info *dinfo,
                           unsigned drawid_offset,
                           const struct pipe_draw_indirect_info *indirect,
                           const struct pipe_draw_start_count_bias *draws,
                           unsigned num_draws)
{
   if (num_draws > 1) {
      util_draw_multi(ctx, dinfo, drawid_offset, indirect, draws, num_draws);
      return;
   }

   if (!indirect && (!draws[0].count || !dinfo->instance_count))
      return;

   struct virgl_context *vctx = virgl_context(ctx);
   struct virgl_screen *rs = virgl_screen(ctx->screen);
   struct virgl_indexbuf ib = { 0 };
   struct pipe_draw_info info = *dinfo;
...
   if (!vctx->num_draws)
      virgl_reemit_draw_resources(vctx);
   vctx->num_draws++;

   virgl_hw_set_vertex_buffers(vctx);

   virgl_encoder_draw_vbo(vctx, &info, drawid_offset, indirect, &draws[0]);

   pipe_resource_reference(&ib.buffer, NULL);

}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:982`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L982)，用來觀察 direct、tessellation 與 indirect draw 如何選擇 command length，並將 draw parameters 寫進 protocol buffer

```c
int virgl_encoder_draw_vbo(struct virgl_context *ctx,
                           const struct pipe_draw_info *info,
                           unsigned drawid_offset,
                           const struct pipe_draw_indirect_info *indirect,
                           const struct pipe_draw_start_count_bias *draw)
{
   uint32_t length = VIRGL_DRAW_VBO_SIZE;
   if (info->mode == MESA_PRIM_PATCHES || drawid_offset > 0)
      length = VIRGL_DRAW_VBO_SIZE_TESS;
   if (indirect && indirect->buffer)
      length = VIRGL_DRAW_VBO_SIZE_INDIRECT;
   virgl_encoder_write_cmd_dword(ctx, VIRGL_CMD0(VIRGL_CCMD_DRAW_VBO, 0, length));
   virgl_encoder_write_dword(ctx->cbuf, draw->start);
   virgl_encoder_write_dword(ctx->cbuf, draw->count);
   virgl_encoder_write_dword(ctx->cbuf, info->mode);
   virgl_encoder_write_dword(ctx->cbuf, !!info->index_size);
   virgl_encoder_write_dword(ctx->cbuf, info->instance_count);
   virgl_encoder_write_dword(ctx->cbuf, info->index_size ? draw->index_bias : 0);
   virgl_encoder_write_dword(ctx->cbuf, info->start_instance);
   virgl_encoder_write_dword(ctx->cbuf, info->primitive_restart);
   virgl_encoder_write_dword(ctx->cbuf, info->primitive_restart ? info->restart_index : 0);
   virgl_encoder_write_dword(ctx->cbuf, info->index_bounds_valid ? info->min_index : 0);
   virgl_encoder_write_dword(ctx->cbuf, info->index_bounds_valid ? info->max_index : ~0);
   if (indirect && indirect->count_from_stream_output)
      virgl_encoder_write_dword(ctx->cbuf, indirect->count_from_stream_output->buffer_size);
   else
      virgl_encoder_write_dword(ctx->cbuf, 0);
...
}
```

draw callback 因而扮演 state 驗證與 command emission 的匯合點。 shader object、vertex buffer、sampler view 與 index buffer 都已用對應的 protocol id 表示，draw command 只攜帶 protocol 定義的欄位。 command 仍留在 `vctx->cbuf`，尚未沿本章圖跨出 guest

#### Command buffer 空間不足會先 flush

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:537`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L537)，用來確認 command header 的 payload length 如何參與空間檢查，以及 buffer 不足時在哪裡觸發 context flush

```c
static int virgl_encoder_write_cmd_dword(struct virgl_context *ctx,
                                        uint32_t dword)
{
   int len = (dword >> 16);

   if ((ctx->cbuf->cdw + len + 1) > VIRGL_MAX_CMDBUF_DWORDS)
      ctx->base.flush(&ctx->base, NULL, 0);

   virgl_encoder_write_dword(ctx->cbuf, dword);
   return 0;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:808`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L808)，用來觀察大型 shader payload 如何跨越多個 command buffers，並以 continuation offset 串起各段內容

```c
int
virgl_encode_shader_state(
   struct virgl_context *ctx,
   uint32_t handle,
   mesa_shader_stage type,
   const struct pipe_stream_output_info *so_info,
   uint32_t cs_req_local_mem,
   const struct tgsi_token *tokens)
{
...
   while (left_bytes) {
      uint32_t length, offlen;
      int hdr_len = base_hdr_size + (first_pass ? strm_hdr_size : 0);
      if (ctx->cbuf->cdw + hdr_len + 1 >= VIRGL_ENCODE_MAX_DWORDS)
         ctx->base.flush(&ctx->base, NULL, 0);

      thispass = (VIRGL_ENCODE_MAX_DWORDS - ctx->cbuf->cdw - hdr_len - 1) * 4;

      length = MIN2(thispass, left_bytes);
      len = ((length + 3) / 4) + hdr_len;

      if (first_pass)
         offlen = VIRGL_OBJ_SHADER_OFFSET_VAL(shader_len);
      else
         offlen = VIRGL_OBJ_SHADER_OFFSET_VAL((uintptr_t)sptr - (uintptr_t)str) | VIRGL_OBJ_SHADER_OFFSET_CONT;

      virgl_emit_shader_header(ctx, handle, len, virgl_shader_stage_convert(type), offlen, num_tokens);

      if (type == MESA_SHADER_COMPUTE)
         virgl_encoder_write_dword(ctx->cbuf, cs_req_local_mem);
      else
         virgl_emit_shader_streamout(ctx, first_pass ? so_info : NULL);

      virgl_encoder_write_block(ctx->cbuf, (uint8_t *)sptr, length);

      sptr += length;
      first_pass = false;
      left_bytes -= length;
...
   }
   ...
}
```

Command buffer rollover 會觸發已安裝的 `pipe_context.flush` callback，由 flush 整理 pending transfer、command 與 fence request 後再進入 submission。 觸發條件是 encoder 空間不足，因此一個 draw 可以只累積 command，也可以在編碼途中推進既有 work

```callgraph
Mesa VirGL state 與 draw encoding
=================================================
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1130] virgl_create_sampler_view(ctx, texture, state)
  │
  ├─ 若 `state == NULL` 或配置失敗
  │    └─ `return NULL`
  └─ 成功
       ├─ `handle = virgl_object_assign_handle()`
       └─ `virgl_encode_sampler_view(vctx, handle, res, state)`
            // object handle、resource reference 與 sampler-view state 寫入 command buffer
  ↓
後續 state binding 與 draw 階段
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1011] virgl_draw_vbo(ctx, dinfo, ..., draws, num_draws)
  │
  ├─ 若 `num_draws > 1`
  │    └─ `util_draw_multi(...)`
  │
  ├─ 若 count 或 instance count 為零
  │    └─ 提前回傳，不產生 command
  │
  ├─ 若 primitive 不在 capability mask
  │    └─ `util_primconvert_draw_vbo(...)`
  │
  └─ 一般路徑
       ├─ 重新發送 draw resources 與 vertex buffers
       └─ [Mesa: src/gallium/drivers/virgl/virgl_encode.c:982] virgl_encoder_draw_vbo(...)
            └─ 寫入 `VIRGL_CCMD_DRAW_VBO` 與 draw parameters
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_encode.c:537] virgl_encoder_write_cmd_dword(ctx, dword)
  ├─ 若 `cdw + len + 1 > VIRGL_MAX_CMDBUF_DWORDS`
  │    └─ `ctx->base.flush(&ctx->base, NULL, 0)`
  └─ 空間可用後寫入 command header
```

### Resource handle 與 BO handle

前一節已經讓 VirGL command buffer 開始引用 shader、buffer 與 texture。 當這批 command 準備提交時，host renderer 必須知道 command 指的是哪個 VirGL resource，guest kernel 則必須知道這次 execbuffer 會存取哪些 GEM BO

同一份 storage 因而會經過兩個不同的 identity namespace。 `res_handle` 寫進 VirGL protocol，`bo_handle` 則放進 DRM execbuffer 的 BO list； 接下來要沿著 resource reference 看這兩個 handle 分別在哪裡被使用

#### Command stream 的 renderer resource handle

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.h:37`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.h#L37)，用來比較 `virgl_hw_res` 保存的 renderer resource identity、kernel BO identity 與生命週期 state

```c
struct virgl_hw_res {
   struct pipe_reference reference;
   enum pipe_texture_target target;
   uint32_t res_handle;
   uint32_t bo_handle;
   int num_cs_references;
   uint32_t size;
   void *ptr;

   struct virgl_resource_cache_entry cache_entry;
   uint32_t bind;
   uint32_t flags;
   uint32_t flink_name;

   /* We are not holding a lock when releasing references of the
    * resource (intentionally) so we might start destroying it in one thread
    * while briefly increasing the reference in another one leading to the
    * free function being called twice, this ensures that it will be only
    * called once. */
   int needed_references;

   /* false when the resource is known to be typed */
   bool maybe_untyped;

   /* true when the resource is imported or exported */
   int external;

   /* false when the resource is known to be idle */
   int maybe_busy;
   uint32_t blob_mem;
};
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:838`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L838)，用來觀察同一個 resource emission 入口如何分別更新 protocol dwords 與 submission 的 BO reference list

```c
static void virgl_drm_emit_res(struct virgl_winsys *qws,
                               struct virgl_cmd_buf *_cbuf,
                               struct virgl_hw_res *res, bool write_buf)
{
   struct virgl_drm_winsys *qdws = virgl_drm_winsys(qws);
   struct virgl_drm_cmd_buf *cbuf = virgl_drm_cmd_buf(_cbuf);

   if (write_buf)
      cbuf->base.buf[cbuf->base.cdw++] = res->res_handle;

   virgl_drm_add_res(qdws, cbuf, res);
}
```

因此 command stream 中看到的整數屬於 VirGL resource namespace。 kernel BO handle 不會被當成 shader sampler 或 vertex buffer 的 protocol id。 `emit_res` 依序處理兩邊，但只有 `virgl_drm_add_res()` 成功時，command resource id 才有對應的 BO list entry

#### Execbuffer 的 BO handle list

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:793`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L793)，用來檢查 BO list 擴張、resource reference ownership，以及配置失敗之後留下的 state

```c
static void
virgl_drm_add_res(struct virgl_drm_winsys *qdws,
                  struct virgl_drm_cmd_buf *cbuf,
                  struct virgl_hw_res *res)
{
...
   if (cbuf->cres >= cbuf->nres) {
      unsigned new_nres = cbuf->nres + 256;
      void *new_ptr = REALLOC(cbuf->res_bo,
                              cbuf->nres * sizeof(struct virgl_hw_buf*),
                              new_nres * sizeof(struct virgl_hw_buf*));
      if (!new_ptr) {
          _debug_printf("failure to add relocation %d, %d\n", cbuf->cres, new_nres);
          return;
      }
      cbuf->res_bo = new_ptr;

      new_ptr = REALLOC(cbuf->res_hlist,
                        cbuf->nres * sizeof(uint32_t),
                        new_nres * sizeof(uint32_t));
      if (!new_ptr) {
          _debug_printf("failure to add hlist relocation %d, %d\n", cbuf->cres, cbuf->nres);
          return;
      }
      cbuf->res_hlist = new_ptr;
      cbuf->nres = new_nres;
   }

   cbuf->res_bo[cbuf->cres] = NULL;
   virgl_drm_resource_reference(&qdws->base, &cbuf->res_bo[cbuf->cres], res);
   cbuf->res_hlist[cbuf->cres] = res->bo_handle;
   p_atomic_inc(&res->num_cs_references);
   cbuf->cres++;
}
```

兩次 `REALLOC` 任一失敗時，這個 void 函式只輸出偵錯訊息並回傳

此時 `virgl_drm_emit_res()` 已先寫入 `res_handle`。 固定實作不會撤銷該 dword，也無法把錯誤傳回 encoder。 command 因而可能引用 resource id，`res_hlist` 卻缺少相應的 `bo_handle`。 cbuf 已有 resource id 不能當成 BO list 已完成的證明

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:954`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L954)，用來確認提交入口如何把 protocol command bytes、BO handle list 與 fences 組成一次 execbuffer request

```c
static int virgl_drm_winsys_submit_cmd(struct virgl_winsys *qws,
                                       struct virgl_cmd_buf *_cbuf,
                                       struct pipe_fence_handle **fence)
{
   struct virgl_drm_winsys *qdws = virgl_drm_winsys(qws);
   struct virgl_drm_cmd_buf *cbuf = virgl_drm_cmd_buf(_cbuf);
   struct drm_virtgpu_execbuffer eb;
   int ret;

   if (cbuf->base.cdw == 0)
      return 0;

   memset(&eb, 0, sizeof(struct drm_virtgpu_execbuffer));
   eb.command = (unsigned long)(void*)cbuf->buf;
   eb.size = cbuf->base.cdw * 4;
   eb.num_bo_handles = cbuf->cres;
   eb.bo_handles = (unsigned long)(void *)cbuf->res_hlist;

   eb.fence_fd = -1;
   if (qws->supports_fences) {
      if (cbuf->in_fence_fd >= 0) {
         eb.flags |= VIRTGPU_EXECBUF_FENCE_FD_IN;
         eb.fence_fd = cbuf->in_fence_fd;
      }

      if (fence != NULL)
         eb.flags |= VIRTGPU_EXECBUF_FENCE_FD_OUT;
   } else {
      assert(cbuf->in_fence_fd < 0);
   }

   ret = drmIoctl(qdws->fd, DRM_IOCTL_VIRTGPU_EXECBUFFER, &eb);
...
}
```

`res_handle` 回答 command 內「操作哪個 renderer resource」，`bo_handle` 清單回答 guest kernel「這次 submission 涉及哪些 GEM objects」。 BO list 的記憶體配置成功時，兩者共同指向同一份 winsys resource 的不同 namespace，execbuffer ioctl 將 command bytes 與 BO list 一起交給 guest kernel

```callgraph
Mesa VirGL command resource tracking
=================================================
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:838] virgl_drm_emit_res(qws, cbuf, res, write_buf)
  │
  ├─ 若 `write_buf == true`
  │    └─ `cbuf->base.buf[cbuf->base.cdw++] = res->res_handle`
  │         // renderer command 參數使用 `res_handle`
  └─ [Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:785] virgl_drm_add_res(qdws, cbuf, res)
       ├─ 若 resource 已在 list，直接回傳
       ├─ 若陣列已滿，以 256 項擴張。 配置失敗則記錄並回傳
       └─ `cbuf->res_hlist[cres] = res->bo_handle`
            // kernel execbuffer BO list 使用 `bo_handle`，同時持有 resource reference
  ↓
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:954] virgl_drm_winsys_submit_cmd(qws, cbuf, fence)
  │
  ├─ 若 `cbuf->base.cdw == 0`
  │    └─ `return 0`
  └─ 有 command
       ├─ `eb.command = cbuf->buf`
       ├─ `eb.bo_handles = cbuf->res_hlist`
       └─ `drmIoctl(fd, DRM_IOCTL_VIRTGPU_EXECBUFFER, &eb)`
            // Linux UAPI 同時收到 command bytes 與實際參照的 BO handles
```

目前的 guest userspace 路徑已建立 VirGL screen、選定 capset、累積 state 與 command，並讓 resource create 產生 renderer resource handle 與 BO handle。 下一個具體問題是 CPU 寫入的 resource 內容如何進入 transfer queue，以及 flush 如何將 command bytes 與 BO handle list 合併成 execbuffer

### Transfer、map 與 queue drain

CPU 要存取 VirGL resource 時，driver 不能直接假設 guest mapping 已含最新內容。 `virgl_resource_transfer_prepare()` 會先判斷目前 command buffer 是否引用同一 resource、host-side storage 是否比 guest 副本新、呼叫端能否等待，以及 discard 是否允許改用新 storage。 map 的結果可能指向原本的 BO、重新配置的 BO，或 staging resource

write map 在 unmap 後也不一定立即發出 ioctl。 buffer 與 texture 的一般寫入會進 transfer queue，driver 可合併相交區間，等 flush 時再選 encoded transfer 或獨立 transfer ioctl。 copy-transfer staging 路徑則依 direction 在 unmap 前後直接編碼，不與一般 queue entry 混在一起

#### Map 前的 hazard decision

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:121`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L121)，用來比較 map 前的 flush 與 readback 判斷各自依賴哪些 flags 與 resource state

```c
static bool virgl_res_needs_flush(struct virgl_context *vctx,
                                  struct virgl_transfer *trans)
{
   struct virgl_winsys *vws = virgl_screen(vctx->base.screen)->vws;
   struct virgl_resource *res = virgl_resource(trans->base.resource);

   if (trans->base.usage & PIPE_MAP_UNSYNCHRONIZED)
      return false;

   if (!vws->res_is_referenced(vws, vctx->cbuf, res->hw_res))
      return false;

   return true;
}
...
static bool virgl_res_needs_readback(struct virgl_context *vctx,
                                     struct virgl_resource *res,
                                     unsigned usage, unsigned level)
{
   if (usage & (PIPE_MAP_DISCARD_RANGE |
                PIPE_MAP_DISCARD_WHOLE_RESOURCE))
      return false;

   if (res->clean_mask & (1 << level))
      return false;

   return true;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:160`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L160)，用來觀察 `virgl_resource_transfer_prepare()` 如何先獨立計算 flush、readback 與 wait，再進入相依關係處理

```c
static enum virgl_transfer_map_type
virgl_resource_transfer_prepare(struct virgl_context *vctx,
                                struct virgl_transfer *xfer,
                                bool is_blob)
{
   struct virgl_screen *vs = virgl_screen(vctx->base.screen);
   struct virgl_winsys *vws = vs->vws;
   struct virgl_resource *res = virgl_resource(xfer->base.resource);
   enum virgl_transfer_map_type map_type = VIRGL_TRANSFER_MAP_HW_RES;
   bool flush;
   bool readback;
   bool wait;

   /* there is no way to map the host storage currently */
   if (xfer->base.usage & PIPE_MAP_DIRECTLY)
      return VIRGL_TRANSFER_MAP_ERROR;

   /* We break the logic down into four steps
    *
    * step 1: determine the required operations independently
    * step 2: look for chances to skip the operations
    * step 3: resolve dependencies between the operations
    * step 4: execute the operations
    */

   flush = virgl_res_needs_flush(vctx, xfer);
   readback = virgl_res_needs_readback(vctx, res, xfer->base.usage,
                                       xfer->base.level);
   /* We need to wait for all cmdbufs, current or previous, that access the
    * resource to finish unless synchronization is disabled.
    */
   wait = !(xfer->base.usage & PIPE_MAP_UNSYNCHRONIZED);
...
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:252`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L252)，用來檢查 readback 如何選擇 staging map，以及重疊的 pending write 為何會強制先 flush

```c
static enum virgl_transfer_map_type
virgl_resource_transfer_prepare(struct virgl_context *vctx,
                                struct virgl_transfer *xfer,
                                bool is_blob)
{
...
   /* readback has some implications */
   if (readback) {
      /* If we are performing readback for textures and renderer supports
       * copy_transfer_from_host, then we can return here with proper map.
       */
      if (res->use_staging) {
         if (xfer->base.usage & PIPE_MAP_READ)
            return VIRGL_TRANSFER_MAP_READ_FROM_STAGING;
         else
            return VIRGL_TRANSFER_MAP_WRITE_TO_STAGING_WITH_READBACK;
      }

      /* When the transfer queue has pending writes to this transfer's region,
       * we have to flush before readback.
       */
      if (!flush && virgl_transfer_queue_is_queued(&vctx->queue, xfer))
         flush = true;
   }

   if (flush)
      vctx->base.flush(&vctx->base, NULL, 0);
...
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:281`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L281)，用來追蹤非阻塞失敗、阻塞 readback 與 staging write 三條 map 路徑

```c
static enum virgl_transfer_map_type
virgl_resource_transfer_prepare(struct virgl_context *vctx,
                                struct virgl_transfer *xfer,
                                bool is_blob)
{
...
   if ((xfer->base.usage & PIPE_MAP_DONTBLOCK) &&
       (readback || (wait && vws->resource_is_busy(vws, res->hw_res))))
      return VIRGL_TRANSFER_MAP_ERROR;

   if (readback) {
      /* Readback is yet another command and is transparent to the state
       * trackers.  It should be waited for in all cases, including when
       * PIPE_MAP_UNSYNCHRONIZED is set.
       */
      if (!is_blob) {
         vws->resource_wait(vws, res->hw_res);
         vws->transfer_get(vws, res->hw_res, &xfer->base.box, xfer->base.stride,
                           xfer->l_stride, xfer->offset, xfer->base.level);
      }
      /* transfer_get puts the resource into a maybe_busy state, so we will have
       * to wait another time if we want to use that resource. */
      wait = true;
   }

   if (wait)
      vws->resource_wait(vws, res->hw_res);

   if (res->use_staging) {
      map_type = VIRGL_TRANSFER_MAP_WRITE_TO_STAGING;
   }

   return map_type;
...
}
```

阻塞 readback 會先等待 resource、呼叫 `transfer_get()`，再等待一次。 固定版本忽略 `transfer_get()` 的整數結果，`resource_wait()` 也只記錄 errno，因此底層錯誤不會改變 map type

hazard decision 以 enum 回傳 `VIRGL_TRANSFER_MAP_HW_RES`、`REALLOC`、staging read／write 或 error，`virgl_resource_transfer_map()` 再依類型取得 mapping。 這個 enum 只表達函式明確辨識的 decision，不涵蓋被 winsys callback 吞掉的 readback 或 wait error

#### Unmap 進 transfer queue

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_buffer.c:31`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_buffer.c#L31)，用來比較 buffer unmap 對 explicit-flush range、staging copy 與一般 writes 的處理方式

```c
void virgl_buffer_transfer_unmap(struct pipe_context *ctx,
                                 struct pipe_transfer *transfer)
{
   struct virgl_context *vctx = virgl_context(ctx);
   struct virgl_transfer *trans = virgl_transfer(transfer);
   bool persistent_coherent = trans->base.usage & (PIPE_MAP_PERSISTENT |
                                                   PIPE_MAP_COHERENT);

   if ((trans->base.usage & PIPE_MAP_WRITE) && !persistent_coherent) {
      if (transfer->usage & PIPE_MAP_FLUSH_EXPLICIT) {
         if (trans->range.end <= trans->range.start) {
            virgl_resource_destroy_transfer(vctx, trans);
            return;
         }

         transfer->box.x += trans->range.start;
         transfer->box.width = trans->range.end - trans->range.start;
         trans->offset = transfer->box.x;
      }

      if (trans->copy_src_hw_res && trans->direction == VIRGL_TRANSFER_TO_HOST) {
         virgl_encode_copy_transfer(vctx, trans);
         virgl_resource_destroy_transfer(vctx, trans);
      } else if (trans->copy_src_hw_res && trans->direction == VIRGL_TRANSFER_FROM_HOST) {
         // if it is readback, then we have already encoded transfer
         virgl_resource_destroy_transfer(vctx, trans);
      } else {
         virgl_transfer_queue_unmap(&vctx->queue, trans);
      }
   } else
      virgl_resource_destroy_transfer(vctx, trans);
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_transfer_queue.c:301`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_transfer_queue.c#L301)，用來觀察一般 buffer writes 如何合併重疊範圍並加入 transfer queue

```c
int virgl_transfer_queue_unmap(struct virgl_transfer_queue *queue,
                               struct virgl_transfer *transfer)
{
   struct list_iteration_args iter;

   /* We don't support copy transfers in the transfer queue. */
   assert(!transfer->copy_src_hw_res);

   /* Attempt to merge multiple intersecting transfers into a single one. */
   if (transfer->base.resource->target == PIPE_BUFFER) {
      memset(&iter, 0, sizeof(iter));
      iter.current = transfer;
      iter.compare = transfers_intersect;
      iter.action = replace_unmapped_transfer;
      compare_and_perform_action(queue, &iter);
   }

   add_internal(queue, transfer);
   return 0;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_texture.c:297`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_texture.c#L297)，用來比較 texture unmap 對 copy-to-host、readback 與一般 queued writes 的分流

```c
void
virgl_texture_transfer_unmap(struct pipe_context *ctx,
                             struct pipe_transfer *transfer)
{
...
   if (queue_unmap) {
      if (trans->copy_src_hw_res && trans->direction == VIRGL_TRANSFER_TO_HOST) {
         virgl_encode_copy_transfer(vctx, trans);
         virgl_resource_destroy_transfer(vctx, trans);
      } else if (trans->copy_src_hw_res && trans->direction == VIRGL_TRANSFER_FROM_HOST) {
         // if it is readback, then we have already encoded transfer
         virgl_resource_destroy_transfer(vctx, trans);
      } else {
         virgl_transfer_queue_unmap(&vctx->queue, trans);
      }
   } else {
      virgl_resource_destroy_transfer(vctx, trans);
   }
}
```

unmap 完成只代表 CPU 不再使用 mapping。 queued transfer 尚未送出時，後續 map hazard 檢查仍可透過 `virgl_transfer_queue_is_queued()` 找到重疊區域。 resource 與 transfer references 也會留到 entry 被 encode 或 direct put 後才釋放

#### Encoded transfer 與獨立 ioctl

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_transfer_queue.c:182`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_transfer_queue.c#L182)，用來比較 queue drain 的 direct-transfer 與 encoded-transfer actions，以及兩者如何移除 entry

```c
static void transfer_put(struct virgl_transfer_queue *queue,
                         struct list_action_args *args)
{
   struct virgl_transfer *queued = args->queued;

   queue->vs->vws->transfer_put(queue->vs->vws, queued->hw_res,
                                &queued->base.box,
                                queued->base.stride, queued->l_stride,
                                queued->offset, queued->base.level);

   remove_transfer(queue, queued);
}

static void transfer_write(struct virgl_transfer_queue *queue,
                           struct list_action_args *args)
{
   struct virgl_transfer *queued = args->queued;
   struct virgl_cmd_buf *buf = args->data;

   // Takes a reference on the HW resource, which is released after
   // the exec buffer command.
   virgl_encode_transfer(queue->vs, buf, queued, VIRGL_TRANSFER_TO_HOST);

   remove_transfer(queue, queued);
}
```

`transfer_put()` 丟棄 winsys callback 的整數結果，之後仍會移除 entry。 以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_transfer_queue.c:322`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_transfer_queue.c#L322)，用來觀察整個 queue 如何選擇 encoded 或 direct drain，並處理預留的 command-buffer 空間

```c
int virgl_transfer_queue_clear(struct virgl_transfer_queue *queue,
                               struct virgl_cmd_buf *cbuf)
{
   struct list_iteration_args iter;

   memset(&iter, 0, sizeof(iter));
   if (queue->tbuf) {
      uint32_t prior_num_dwords = cbuf->cdw;
      cbuf->cdw = 0;

      iter.action = transfer_write;
      iter.data = cbuf;
      perform_action(queue, &iter);

      virgl_encode_end_transfers(cbuf);
      cbuf->cdw = prior_num_dwords;
   } else {
      iter.action = transfer_put;
      perform_action(queue, &iter);
   }

   queue->num_dwords = 0;

   return 0;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:1690`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L1690)，用來觀察 encoded transfer 的 resource reference、stride policy、offset 與 direction 如何進入 command buffer

```c
void virgl_encode_transfer(struct virgl_screen *vs, struct virgl_cmd_buf *buf,
                           struct virgl_transfer *trans, uint32_t direction)
{
   uint32_t command;
   struct virgl_resource *vres = virgl_resource(trans->base.resource);
   enum virgl_transfer3d_encode_stride stride_type =
        virgl_transfer3d_host_inferred_stride;

   if (trans->base.box.depth == 1 && trans->base.level == 0 &&
       trans->base.resource->target == PIPE_TEXTURE_2D &&
       vres->blob_mem == VIRGL_BLOB_MEM_HOST3D_GUEST)
      stride_type = virgl_transfer3d_explicit_stride;

   command = VIRGL_CMD0(VIRGL_CCMD_TRANSFER3D, 0, VIRGL_TRANSFER3D_SIZE);
   virgl_encoder_write_dword(buf, command);
   virgl_encoder_transfer3d_common(vs, buf, trans, stride_type);
   virgl_encoder_write_dword(buf, trans->offset);
   virgl_encoder_write_dword(buf, direction);
}
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:346`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L346)，用來追蹤 direct to-host transfer 如何把 BO identity 與資料範圍送進獨立 ioctl

```c
static int
virgl_bo_transfer_put(struct virgl_winsys *vws,
                      struct virgl_hw_res *res,
                      const struct pipe_box *box,
                      uint32_t stride, uint32_t layer_stride,
                      uint32_t buf_offset, uint32_t level)
{
   struct virgl_drm_winsys *vdws = virgl_drm_winsys(vws);
   struct drm_virtgpu_3d_transfer_to_host tohostcmd;

   p_atomic_set(&res->maybe_busy, true);

   memset(&tohostcmd, 0, sizeof(tohostcmd));
   tohostcmd.bo_handle = res->bo_handle;
   tohostcmd.box.x = box->x;
   tohostcmd.box.y = box->y;
   tohostcmd.box.z = box->z;
   tohostcmd.box.w = box->width;
   tohostcmd.box.h = box->height;
   tohostcmd.box.d = box->depth;
   tohostcmd.offset = buf_offset;
   tohostcmd.level = level;

   if (use_explicit_stride(res, level, box->depth))
      tohostcmd.stride = stride;

   return drmIoctl(vdws->fd, DRM_IOCTL_VIRTGPU_TRANSFER_TO_HOST, &tohostcmd);
}
```

以下程式碼來自 [`Linux: include/uapi/drm/virtgpu_drm.h:143`](https://github.com/torvalds/linux/blob/0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53/include/uapi/drm/virtgpu_drm.h#L143)，用來比較 to-host 與 from-host transfer 共用的資料範圍描述，以及方向如何由 ioctl type 區分

```c
struct drm_virtgpu_3d_transfer_to_host {
	__u32 bo_handle;
	struct drm_virtgpu_3d_box box;
	__u32 level;
	__u32 offset;
	__u32 stride;
	__u32 layer_stride;
};

struct drm_virtgpu_3d_transfer_from_host {
	__u32 bo_handle;
	struct drm_virtgpu_3d_box box;
	__u32 level;
	__u32 offset;
	__u32 stride;
	__u32 layer_stride;
};
```

encoded transfer 與 direct ioctl 傳遞相似的 box／stride 資訊，但排程位置不同。 前者在 queue drain 時併入 command submission，後者由 winsys 立即呼叫 Linux UAPI。 選擇條件來自 caps 與 `supports_encoded_transfers`，並非由 application 直接指定

Direct 路徑的失敗邊界停在 winsys callback。 `virgl_bo_transfer_put()` 會把 `DRM_IOCTL_VIRTGPU_TRANSFER_TO_HOST` 的 `-1` 回傳給 queue action，但 `transfer_put()` 丟棄該值，仍執行 `remove_transfer()`，釋放 transfer 持有的 resource references。 `virgl_transfer_queue_clear()` 隨後固定回傳 0，因此 ioctl 失敗不會抵達 `virgl_flush_eq()`，已移除的 entry 也不會留在 queue 中等待重試

### Flush、execbuffer 與 fence

Application 呼叫 `glFlush()`、進入 swap，或 VirGL command buffer 空間不足時，前面累積的 state、draw command 與 transfer 終究必須離開 application 行程。 此時不只要送出 command bytes，尚在 queue 裡的 transfer 也要先處理，command 引用的 resources 則必須存活到 kernel 接手

接下來沿著 State Tracker 的 Gallium flush 追到 `DRM_IOCTL_VIRTGPU_EXECBUFFER`，確認這批 work 如何組成一次 submission，以及呼叫端要求 fence 時，哪個 completion object 會沿原路回到上層

#### State Tracker flush 到 command buffer submit

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1121`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1121)，用來確認 State Tracker 的 Gallium flush callback 如何把 context 與 fence slot 交給 VirGL 的共同 flush 實作

```c
static void virgl_flush_from_st(struct pipe_context *ctx,
                               struct pipe_fence_handle **fence,
                               unsigned flags)
{
   struct virgl_context *vctx = virgl_context(ctx);

   virgl_flush_eq(vctx, vctx, fence);
}

struct pipe_context *
virgl_context_create(struct pipe_screen *pscreen,
                     void *priv,
                     unsigned flags)
{
...
   vctx->base.flush = virgl_flush_from_st;
...
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1086`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1086)，用來追蹤共同 flush 如何略過空 submission、drain transfer queue 與提交 commands，再重建後續 encoding 所需的 context state

```c
void virgl_flush_eq(struct virgl_context *ctx, void *closure,
                    struct pipe_fence_handle **fence)
{
   struct virgl_screen *rs = virgl_screen(ctx->base.screen);

   /* skip empty cbuf */
   if (ctx->cbuf->cdw == ctx->cbuf_initial_cdw &&
       ctx->queue.num_dwords == 0 &&
       !fence)
      return;

   if (ctx->num_draws)
      u_upload_unmap(ctx->uploader);

...
   virgl_transfer_queue_clear(&ctx->queue, ctx->cbuf);

   virgl_submit_cmd(rs->vws, ctx->cbuf, fence);

   /* Reserve some space for transfers. */
   if (ctx->encoded_transfers)
      ctx->cbuf->cdw = VIRGL_MAX_TBUF_DWORDS;

   virgl_encoder_set_sub_ctx(ctx, ctx->hw_sub_ctx_id);

   ctx->cbuf_initial_cdw = ctx->cbuf->cdw;

   /* We have flushed the command queue, including any pending copy transfers
    * involving staging resources.
    */
   ctx->queued_staging_res_size = 0;
}
```

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1070`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1070)，用來比較 debug-sync 與一般 submission 的 fence handling，並檢查 winsys error 是否會向上傳遞

```c
static void virgl_submit_cmd(struct virgl_winsys *vws,
                             struct virgl_cmd_buf *cbuf,
			     struct pipe_fence_handle **fence)
{
   if (unlikely(virgl_debug & VIRGL_DEBUG_SYNC)) {
      struct pipe_fence_handle *sync_fence = NULL;

      vws->submit_cmd(vws, cbuf, &sync_fence);

      vws->fence_wait(vws, sync_fence, OS_TIMEOUT_INFINITE);
      vws->fence_reference(vws, &sync_fence, NULL);
   } else {
      vws->submit_cmd(vws, cbuf, fence);
   }
}
```

`virgl_submit_cmd()` 的回傳型態是 void，兩個分支都忽略 `vws->submit_cmd()` 的整數結果。 上一層 `virgl_flush_from_st()` 也是 void callback，因此 winsys errno 到此終止，無法成為 `glFlush()` 的同步回傳值或 OpenGL error

flush 因而不是只將 `cdw` 歸零。 pending CPU writes 會先依 queue mode 變成 encoded transfer 或 direct ioctl，主要 command buffer 才會提交。 Direct transfer ioctl 失敗時，queue entry 已移除，固定的 0 回傳值也會遮蔽這個錯誤

Submission 成功且呼叫端要求 fence 時，回傳 object 才對應這次 execbuffer 的 completion 邊界。 Execbuffer submission 失敗時，winsys 仍清除 command 與 resource list，上層 VirGL flush 同樣不會收到該錯誤

#### DRM winsys execbuffer

以下程式碼來自 [`Linux: include/uapi/drm/virtgpu_drm.h:67`](https://github.com/torvalds/linux/blob/0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53/include/uapi/drm/virtgpu_drm.h#L67)，用來觀察 command bytes、BO handles 與 synchronization 欄位如何共同描述一次 virtio-gpu submission

```c
#define VIRTGPU_EXECBUF_SYNCOBJ_RESET		0x01
#define VIRTGPU_EXECBUF_SYNCOBJ_FLAGS ( \
		VIRTGPU_EXECBUF_SYNCOBJ_RESET | \
		0)
struct drm_virtgpu_execbuffer_syncobj {
	__u32 handle;
	__u32 flags;
	__u64 point;
};

/* fence_fd is modified on success if VIRTGPU_EXECBUF_FENCE_FD_OUT flag is set. */
struct drm_virtgpu_execbuffer {
	__u32 flags;
	__u32 size;
	__u64 command; /* void* */
	__u64 bo_handles;
	__u32 num_bo_handles;
	__s32 fence_fd; /* in/out fence fd (see VIRTGPU_EXECBUF_FENCE_FD_IN/OUT) */
	__u32 ring_idx; /* command ring index (see VIRTGPU_EXECBUF_RING_IDX) */
	__u32 syncobj_stride; /* size of @drm_virtgpu_execbuffer_syncobj */
	__u32 num_in_syncobjs;
	__u32 num_out_syncobjs;
	__u64 in_syncobjs;
	__u64 out_syncobjs;
};
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:985`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L985)，用來追蹤 execbuffer 回傳後的 command reset、fence ownership 與 resource-reference 清理

```c
static int
virgl_drm_winsys_submit_cmd(struct virgl_winsys *qws,
                            struct virgl_cmd_buf *_cbuf,
                            struct pipe_fence_handle **fence)
{
...
   ret = drmIoctl(qdws->fd, DRM_IOCTL_VIRTGPU_EXECBUFFER, &eb);
   if (ret == -1)
      _debug_printf("got error from kernel - expect bad rendering %d\n", errno);
   cbuf->base.cdw = 0;

   if (qws->supports_fences) {
      if (cbuf->in_fence_fd >= 0) {
         close(cbuf->in_fence_fd);
         cbuf->in_fence_fd = -1;
      }

      if (fence != NULL && ret == 0)
         *fence = virgl_drm_fence_create(qws, eb.fence_fd, false);
   } else {
      if (fence != NULL && ret == 0)
         *fence = virgl_drm_fence_create_legacy(qws);
   }

   virgl_drm_clear_res_list(cbuf);

   return ret;
}
```

`DRM_IOCTL_VIRTGPU_EXECBUFFER` 是 guest Mesa flush 的 Linux userspace handoff。 `drm_virtgpu_execbuffer` 與 ioctl macro 定義 command pointer、BO list、syncobj 與 fence 的 UAPI contract，後方的 kernel owner 依這些欄位執行驗證、排程與 transport

#### Gallium fence 包住 sync-file fd

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.h:111`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.h#L111)，用來比較 fence object 持有的 completion state 與 command buffer 持有的 input fence

```c
struct virgl_drm_fence {
   struct pipe_reference reference;
   bool external;
   int fd;
   struct virgl_hw_res *hw_res;
};

struct virgl_drm_cmd_buf {
   struct virgl_cmd_buf base;

   uint32_t *buf;

   int in_fence_fd;
...
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:900`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L900)，用來檢查 external 與 execbuffer-output fence fd 的 ownership，以及 wrapper 配置失敗的清理

```c
static struct pipe_fence_handle *
virgl_drm_fence_create(struct virgl_winsys *vws, int fd, bool external)
{
   struct virgl_drm_fence *fence;

   assert(vws->supports_fences);

   if (external) {
      fd = os_dupfd_cloexec(fd);
      if (fd < 0)
         return NULL;
   }

   fence = CALLOC_STRUCT(virgl_drm_fence);
   if (!fence) {
      close(fd);
      return NULL;
   }

   fence->fd = fd;
   fence->external = external;

   pipe_reference_init(&fence->reference, 1);

   return (struct pipe_fence_handle *)fence;
}
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1040`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1040)，用來觀察 external sync-file 如何包成 Gallium fence，以及 nanosecond timeout 如何轉成 `sync_wait()` 參數

```c
static struct pipe_fence_handle *
virgl_cs_create_fence(struct virgl_winsys *vws, int fd)
{
   if (!vws->supports_fences)
      return NULL;

   return virgl_drm_fence_create(vws, fd, true);
}

static bool virgl_fence_wait(struct virgl_winsys *vws,
                             struct pipe_fence_handle *_fence,
                             uint64_t timeout)
{
   struct virgl_drm_fence *fence = virgl_drm_fence(_fence);

   if (vws->supports_fences) {
      uint64_t timeout_ms;
      int timeout_poll;

      if (timeout == 0)
         return sync_wait(fence->fd, 0) == 0;

      timeout_ms = timeout / 1000000;
      /* round up */
      if (timeout_ms * 1000000 < timeout)
         timeout_ms++;

      timeout_poll = timeout_ms <= INT_MAX ? (int) timeout_ms : -1;

      return sync_wait(fence->fd, timeout_poll) == 0;
...
   }
   ...
   return true;
}
```

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1126`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1126)，用來確認 fence fd 匯出後，呼叫端與 fence object 如何各自持有獨立 descriptor

```c
static int virgl_fence_get_fd(struct virgl_winsys *vws,
                              struct pipe_fence_handle *_fence)
{
   struct virgl_drm_fence *fence = virgl_drm_fence(_fence);

   if (!vws->supports_fences)
      return -1;

   return os_dupfd_cloexec(fence->fd);
}
```

這個 `pipe_fence_handle` 包裝 guest Linux sync-file，由 Gallium 呼叫端以 wait／reference callbacks 管理。 下一節 virglrenderer 公開 API 中的 client fence id 屬於 host 行程 contract，它的 identity 與 completion callback 由 VMM 擁有的呼叫端建立

```callgraph
Mesa State Tracker to VirGL flush
=================================================
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1121] virgl_flush_from_st(ctx, fence, flags)
  └─ [Mesa: src/gallium/drivers/virgl/virgl_context.c:1086] virgl_flush_eq(vctx, closure, fence)
       │
       ├─ 若 command buffer 與 transfer queue 都為空，而且呼叫端不要 fence
       │    └─ `return`
       │         // 沒有 pending work 時不建立空 submission
       │
       ├─ 若有 draw
       │    └─ `u_upload_unmap(ctx->uploader)`
       │
       ├─ [Mesa: src/gallium/drivers/virgl/virgl_transfer_queue.c:322] virgl_transfer_queue_clear(&ctx->queue, ctx->cbuf)
       │    ├─ 可 encode 的 transfer 寫入 `TRANSFER3D`
       │    ├─ 需要獨立 ioctl 的 transfer
       │    │    └─ [Mesa: src/gallium/drivers/virgl/virgl_transfer_queue.c:182] transfer_put(queue, args)
       │    │         ├─ `queue->vs->vws->transfer_put(...)`
       │    │         │    ↓
       │    │         │  [Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:346] virgl_bo_transfer_put(...)
       │    │         │    └─ `return drmIoctl(fd, DRM_IOCTL_VIRTGPU_TRANSFER_TO_HOST, ...)`
       │    │         │         // queue action 丟棄 int 結果，ioctl 失敗不向上傳遞
       │    │         └─ `remove_transfer(queue, queued)`
       │    │              // 不論 ioctl 結果都移除 entry 並釋放 transfer references
       │    └─ 清空 `num_dwords`，固定 `return 0`
       │         // `virgl_flush_eq()` 沒有消費這個回傳值
       │
       └─ [Mesa: src/gallium/drivers/virgl/virgl_context.c:1070] virgl_submit_cmd(vws, cbuf, fence)
            ├─ 若 `VIRGL_DEBUG_SYNC`
            │    ├─ `vws->submit_cmd(..., &sync_fence)`
            │    └─ `vws->fence_wait(..., OS_TIMEOUT_INFINITE)`
            ├─ 否則 `vws->submit_cmd(vws, cbuf, fence)`
            └─ 兩條分支都丟棄 `submit_cmd()` 的 int 結果
  ↓
Mesa VirGL DRM winsys
=================================================
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:954] virgl_drm_winsys_submit_cmd(qws, cbuf, fence)
  │
  ├─ 填入 `eb.command`、`eb.size`、`eb.bo_handles` 與 `eb.num_bo_handles`
  ├─ 若有 input sync-file，設 `VIRTGPU_EXECBUF_FENCE_FD_IN`
  ├─ 若呼叫端要 output fence，設 `VIRTGPU_EXECBUF_FENCE_FD_OUT`
  └─ `drmIoctl(fd, DRM_IOCTL_VIRTGPU_EXECBUFFER, &eb)`
       ├─ 失敗：回傳 `-1`，以 errno 寫偵錯訊息，清理 command resource list
       └─ 成功：必要時把 `eb.fence_fd` 包成 `pipe_fence_handle`
            // 成功結果是 work 已交給 Linux virtio-gpu UAPI
```

### virglrenderer 公開 API 邊界

Guest kernel 接受 execbuffer 後，這批 VirGL command 還需要被送到 host 行程執行。 VMM 的虛擬裝置模型收到 guest 建立的 context、resource、transfer 與 command work 後，會透過 virglrenderer 的公開 API 建立對應的 renderer state

這個交接點決定 VMM 必須保存哪些 context／resource identity、提供哪些 GL context 與 fence callbacks，以及如何把 completion 納入自己的 event loop。 因此，接下來從 VMM 初始化 renderer 的動作開始，再看 command、transfer、fence 與清理如何共用這套公開 contract。 Guest ioctl 與函式庫呼叫之間的 command transport 和映射，則由 kernel、virtqueue 與 VMM device model 接起來

#### VMM 提供 callback 並初始化 renderer

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:25`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L25) 的公開 ABI 檔頭、`virgl_renderer_gl_context` 與 `virgl_renderer_gl_ctx_param`，用來確認 VMM 到 virglrenderer 的呼叫方向，以及 host GL context callback 能看見哪些設定：

```c
/* library interface from QEMU to virglrenderer */

#ifndef VIRGLRENDERER_H
#define VIRGLRENDERER_H

#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>

#include "virgl-version.h"

struct virgl_box;
struct iovec;

#define VIRGL_EXPORT  __attribute__((visibility("default")))

typedef void *virgl_renderer_gl_context;

struct virgl_renderer_gl_ctx_param {
   int version;
   bool shared;
   int major_ver;
   int minor_ver;
   int compat_ctx;
};
```

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:51`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L51) 的 `struct virgl_renderer_callbacks`，用來觀察 VMM 如何提供 GL context 生命週期與 fence completion callbacks：

```c
#define VIRGL_RENDERER_CALLBACKS_VERSION 4

struct virgl_renderer_callbacks {
   int version;
   void (*write_fence)(void *cookie, uint32_t fence);

...
   /* create a GL/GLES context */
   virgl_renderer_gl_context (*create_gl_context)(void *cookie, int scanout_idx, struct virgl_renderer_gl_ctx_param *param);
   /* destroy a GL/GLES context */
   void (*destroy_gl_context)(void *cookie, virgl_renderer_gl_context ctx);
   /* make a context current, returns 0 on success and negative errno on failure */
   int (*make_current)(void *cookie, int scanout_idx, virgl_renderer_gl_context ctx);
...
```

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:169`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L169) 的初始化與 poll declarations，用來確認 renderer 初始化所需的呼叫端 state，以及 VMM 如何主動推進 fence notifications：

```c
/* Blob allocations must be done by guest from dedicated heap (Host visible memory). */
#define VIRGL_RENDERER_USE_GUEST_VRAM (1 << 14)

VIRGL_EXPORT int virgl_renderer_init(void *cookie, int flags, struct virgl_renderer_callbacks *cb);
VIRGL_EXPORT void virgl_renderer_poll(void); /* force fences */

/* we need to give qemu the cursor resource contents */
VIRGL_EXPORT void *virgl_renderer_get_cursor_data(uint32_t resource_id, uint32_t *width, uint32_t *height);

VIRGL_EXPORT void virgl_renderer_get_rect(int resource_id, struct iovec *iov, unsigned int num_iovs,
                                          uint32_t offset, int x, int y, int width, int height);
```

`virgl_renderer_init()` 的 `int` 回傳值讓呼叫端判斷初始化是否成立。 公開 declaration 只固定輸入與回傳型態。 renderer instance layout、初始化子系統與失敗 unwind 都留在 ABI 後方

#### Context、resource 與 command contract

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:206`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L206) 的 `struct virgl_renderer_resource_create_args`，用來觀察公開 resource identity 與 host resource shape 如何一起交給函式庫：

```c
struct virgl_renderer_resource_create_args {
   uint32_t handle;
   uint32_t target;
   uint32_t format;
   uint32_t bind;
   uint32_t width;
   uint32_t height;
   uint32_t depth;
   uint32_t array_size;
   uint32_t last_level;
   uint32_t nr_samples;
   uint32_t flags;
};
```

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:278`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L278) 的 resource、context 與 command exports，用來比較三類 object 生命週期入口，並確認 command buffer 的 identity、size 與 ownership contract：

```c
VIRGL_EXPORT int virgl_renderer_resource_create(struct virgl_renderer_resource_create_args *args, struct iovec *iov, uint32_t num_iovs);
VIRGL_EXPORT int virgl_renderer_resource_import_eglimage(struct virgl_renderer_resource_create_args *args, void *image);
VIRGL_EXPORT void virgl_renderer_resource_unref(uint32_t res_handle);

VIRGL_EXPORT void virgl_renderer_resource_set_priv(uint32_t res_handle, void *priv);
VIRGL_EXPORT void *virgl_renderer_resource_get_priv(uint32_t res_handle);

VIRGL_EXPORT int virgl_renderer_context_create(uint32_t handle, uint32_t nlen, const char *name);
VIRGL_EXPORT void virgl_renderer_context_destroy(uint32_t handle);

/* Submit a command buffer for execution.  ctx_id is the context ID.
 * ndw is the length of the buffer in 4-byte words.
 *
 * The buffer must be at least 4-byte aligned.  Starting in 1.0.2, this
 * is checked and violations result in EFAULT being returned.  In 1.0.1
 * and below, a misaligned buffer caused undefined behavior.
 *
 * Some renderers require that the buffer is 8-byte aligned.  These
 * renderers deal with less-aligned buffers by copying the input data.
 * You can avoid the copy by passing a sufficiently-aligned buffer.
 *
 * This function will never mutate the buffer, and is secure against
 * malicious buffer contents.  However, it is _not_ secure against
 * concurrent modification of the buffer by other threads while it
 * is running.
 */
VIRGL_EXPORT int virgl_renderer_submit_cmd(void *buffer,
                                           int ctx_id,
                                           int ndw);
```

`ctx_id` 與 `res_handle` 的關聯另由 attach／detach API 表達。 capset query、fence create 與 resource attachment 都是 VMM 可直接呼叫的函式庫 contract，並不等同於 Mesa winsys 內部的 C 函式呼叫

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:331`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L331) 的 resource-backing、fence 與 context-attachment exports，用來顯示 `resource_attach_iov()` 如何建立 backing ownership、`create_fence()` 如何建立 completion token，以及 `ctx_attach_resource()` 如何把既有 `ctx_id` 和 `res_handle` 關聯起來：

```c
VIRGL_EXPORT void virgl_renderer_fill_caps(uint32_t set, uint32_t version,
                                           void *caps);

VIRGL_EXPORT int virgl_renderer_resource_attach_iov(int res_handle, struct iovec *iov,
                                                    int num_iovs);
VIRGL_EXPORT void virgl_renderer_resource_detach_iov(int res_handle, struct iovec **iov, int *num_iovs);

VIRGL_EXPORT int virgl_renderer_create_fence(int client_fence_id, uint32_t ctx_id);

VIRGL_EXPORT void virgl_renderer_force_ctx_0(void);

VIRGL_EXPORT void virgl_renderer_ctx_attach_resource(int ctx_id, int res_handle);
VIRGL_EXPORT void virgl_renderer_ctx_detach_resource(int ctx_id, int res_handle);
```

`ctx_id`、`res_handle` 與 command `buffer` 在公開 header 中各有獨立參數。 這讓 VMM 擁有的呼叫端能依虛擬裝置 state 呼叫函式庫，也要求呼叫端在建立、attach、submit、detach 與 destroy 時傳入正確的 identity

resource 建立有 classic 與 blob 兩個公開入口。 Classic 路徑使用 `virgl_renderer_resource_create_args` 與 optional iovecs

[`virglrenderer: src/virglrenderer.h:408`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L408) 的 blob args 明確帶 `res_handle`、`ctx_id`、`blob_mem`、flags、blob id、size 與 iovecs。 [`virglrenderer: src/virglrenderer.h:420`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L420) 則公開 `virgl_renderer_resource_create_blob()`

兩個入口使用不同的 argument shape，呼叫端依虛擬裝置提供的 resource 類型選擇公開呼叫

#### Transfer、fence 與 poll

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:308`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L308) 的 transfer 與 capset exports，用來確認 host 行程如何描述 transfer 範圍，以及 capability query 如何指定 set 與 version：

```c
VIRGL_EXPORT int virgl_renderer_transfer_read_iov(uint32_t handle, uint32_t ctx_id,
                                                  uint32_t level, uint32_t stride,
                                                  uint32_t layer_stride,
                                                  struct virgl_box *box,
                                                  uint64_t offset, struct iovec *iov,
                                                  int iovec_cnt);

VIRGL_EXPORT int virgl_renderer_transfer_write_iov(uint32_t handle,
                                                   uint32_t ctx_id,
                                                   int level,
                                                   uint32_t stride,
                                                   uint32_t layer_stride,
                                                   struct virgl_box *box,
                                                   uint64_t offset,
                                                   struct iovec *iovec,
                                                   unsigned int iovec_cnt);

VIRGL_EXPORT void virgl_renderer_get_cap_set(uint32_t set, uint32_t *max_ver,
                                             uint32_t *max_size);

VIRGL_EXPORT void virgl_renderer_fill_caps(uint32_t set, uint32_t version,
                                           void *caps);

VIRGL_EXPORT int virgl_renderer_resource_attach_iov(int res_handle, struct iovec *iov,
                                                    int num_iovs);
VIRGL_EXPORT void virgl_renderer_resource_detach_iov(int res_handle, struct iovec **iov, int *num_iovs);

VIRGL_EXPORT int virgl_renderer_create_fence(int client_fence_id, uint32_t ctx_id);
```

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:79`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L79) 的 per-context fence contract，用來確認 completion ordering、callback identity 與 mergeable notification semantics：

```c
...
   /*
    * v3: Per-context fences signal in creation order only within a context.
    * Two per-context fences in two contexts might signal in any order.
    *
    * When a per-context fence is created, a fence cookie can be specified. The
    * cookie will be passed to write_context_fence callback. This replaces
    * fence_id that is used in ctx0 fencing.
    *
    * write_context_fence is called on each fence unless the fence has
    * VIRGL_RENDERER_FENCE_FLAG_MERGEABLE set. When the bit is set,
    * write_context_fence might be skipped.
    */
   void (*write_context_fence)(void *cookie, uint32_t ctx_id, uint32_t ring_idx, uint64_t fence_id);
...
```

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:454`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L454) 的 context-fence 與輪詢 exports，用來觀察 VMM 如何建立 fence、整合 event loop，並接管 fixed mapping 的清理責任：

```c
#define VIRGL_RENDERER_FENCE_FLAG_MERGEABLE      (1 << 0)
VIRGL_EXPORT int virgl_renderer_context_create_fence(uint32_t ctx_id,
                                                     uint32_t flags,
                                                     uint32_t ring_idx,
                                                     uint64_t fence_id);

VIRGL_EXPORT void virgl_renderer_context_poll(uint32_t ctx_id); /* force fences */
VIRGL_EXPORT int virgl_renderer_context_get_poll_fd(uint32_t ctx_id);

/* Map a resource to an specific userspace address. If successful, the
 * mapping is owned by the caller and is its responsibility to unmap
 * the resource by its own means (i.e. overriding the map with
 * anonymous memory or calling munmap).
 *
 * Returns -EOPNOTSUPP if mapping the resource using this mechanism is
 * not supported. In that case, you can still try mapping the resource
 * using virgl_renderer_resource_map().
 */
VIRGL_EXPORT int
virgl_renderer_resource_map_fixed(uint32_t res_handle, void *addr);
```

Transfer、fence 與 poll 函式形成 VMM 擁有的呼叫端可見的同步表面。 呼叫端提交 resource range 後建立 fence，再以 poll 推進函式庫的 retirement 與 completion callback

#### Resource query、extension command 與 renderer 生命週期

以下程式碼來自 [`virglrenderer: src/virglrenderer.h:377`](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/dc35e4db03144f81637c5ad061f61d3334b078fe/src/virglrenderer.h#L377)，用來確認 VMM 可使用哪些 resource-query、輪詢、extension 與 renderer 生命週期入口：

```c
VIRGL_EXPORT int virgl_renderer_resource_get_info(int res_handle,
                                                  struct virgl_renderer_resource_info *info);

VIRGL_EXPORT int virgl_renderer_resource_get_info_ext(int res_handle,
                                                      struct virgl_renderer_resource_info_ext *info);

VIRGL_EXPORT void virgl_renderer_cleanup(void *cookie);

/* reset the rendererer - destroy all contexts and resource */
VIRGL_EXPORT void virgl_renderer_reset(void);

VIRGL_EXPORT int virgl_renderer_get_poll_fd(void);

VIRGL_EXPORT int virgl_renderer_execute(void *execute_args, uint32_t execute_size);
```

`resource_get_info()` 與 `resource_get_info_ext()` 以 `res_handle` 查詢公開 metadata。 `cleanup()` 接收 cookie，`reset()` 操作全部 context 與 resource

`get_poll_fd()` 回傳可放進 event loop 的 fd。 `execute()` 則以 pointer 加 byte size 接收擴充參數

這組 API 證明 VMM 可以建立哪些 virglrenderer object，交付哪些 command 與 transfer，以及函式庫用哪些 callbacks 回報 completion。 Guest `DRM_IOCTL_VIRTGPU_EXECBUFFER` 到這組公開 API 之間的 transport 與轉接由 VMM-owned code 與虛擬裝置模型負責

```callgraph
VMM 擁有的呼叫端建立 virglrenderer 公開 contract
=================================================
[virglrenderer: src/virglrenderer.h:51] struct virgl_renderer_callbacks
  │
  ├─ `version`：指定 callback table ABI version
  ├─ `create_gl_context(cookie, scanout_idx, param)`
  ├─ `destroy_gl_context(cookie, ctx)`
  ├─ `make_current(cookie, scanout_idx, ctx)`
  │    ├─ 成功：回傳 0
  │    └─ 失敗：回傳 negative errno
  ├─ `write_fence(cookie, fence)`
  └─ `write_context_fence(cookie, ctx_id, ring_idx, fence_id)`
       // GL context 與 completion 都經呼叫端提供的 callback 回傳
  ↓
[virglrenderer: src/virglrenderer.h:172] virgl_renderer_init(cookie, flags, cb)
  │
  ├─ input：呼叫端擁有的 cookie、renderer flags、callback table
  └─ output：`int` 初始化結果
       // 公開 ABI 到此不公開 renderer 的 instance layout
  ↓

公開 context 與 resource identity
=================================================
[virglrenderer: src/virglrenderer.h:285] virgl_renderer_context_create(handle, nlen, name)
  │
  │  `handle` 是後續 submit、attach、transfer 與 fence API 使用的 context identity
  ↓
resource 建立方式
  ├─ [virglrenderer: src/virglrenderer.h:278] virgl_renderer_resource_create(args, iov, num_iovs)
  │    ├─ `args->handle`：classic resource identity
  │    └─ target、format、bind、尺寸與 optional iovec backing
  │
  └─ [virglrenderer: src/virglrenderer.h:408] struct virgl_renderer_resource_create_blob_args
       └─ [virglrenderer: src/virglrenderer.h:420] virgl_renderer_resource_create_blob(args)
            ├─ `res_handle` + `ctx_id`
            └─ `blob_mem` + flags + blob id + size + iovecs
  ↓
[virglrenderer: src/virglrenderer.h:339] virgl_renderer_ctx_attach_resource(ctx_id, res_handle)
  │
  │  // 呼叫端明確關聯兩個分別建立的公開 identity
  ↓

Command、transfer 與 completion handoff
=================================================
[virglrenderer: src/virglrenderer.h:304] virgl_renderer_submit_cmd(buffer, ctx_id, ndw)
  │
  ├─ `buffer` 至少 4-byte aligned，函式庫不修改內容
  ├─ `ctx_id` 選擇公開 context identity
  └─ `ndw` 以 4-byte words 表示 command 長度
  ↓
[virglrenderer: src/virglrenderer.h:308] virgl_renderer_transfer_read_iov(...)
[virglrenderer: src/virglrenderer.h:315] virgl_renderer_transfer_write_iov(...)
  │
  │  resource handle + context id + level／stride／box／offset + iovecs
  ↓
fence 建立方式
  ├─ [virglrenderer: src/virglrenderer.h:335] virgl_renderer_create_fence(client_fence_id, ctx_id)
  │    └─ completion 經 `write_fence(cookie, fence)` 回傳
  │
  └─ [virglrenderer: src/virglrenderer.h:455] virgl_renderer_context_create_fence(...)
       └─ [virglrenderer: src/virglrenderer.h:460] virgl_renderer_context_poll(ctx_id)
            // completion 經 `write_context_fence(cookie, ctx_id, ring_idx, fence_id)` 回傳
  ↓

呼叫端可見的輪詢入口與函式庫生命週期 API
=================================================
[virglrenderer: src/virglrenderer.h:388] virgl_renderer_get_poll_fd()
  │
  │  // active renderer 可將 completion fd 納入呼叫端 event loop
  ↓
呼叫端選擇 object teardown 方式
  ├─ 逐一拆除公開 identity
  │    ├─ [virglrenderer: src/virglrenderer.h:340] virgl_renderer_ctx_detach_resource(ctx_id, res_handle)
  │    ├─ [virglrenderer: src/virglrenderer.h:280] virgl_renderer_resource_unref(res_handle)
  │    └─ [virglrenderer: src/virglrenderer.h:286] virgl_renderer_context_destroy(handle)
  │
  └─ [virglrenderer: src/virglrenderer.h:386] virgl_renderer_reset()
       └─ 公開註解：重設 renderer，並銷毀所有 contexts 與 resources
  ↓
[virglrenderer: src/virglrenderer.h:383] virgl_renderer_cleanup(cookie)
  │
  │  // 最終結果：呼叫端只依公開 handle、cookie、回傳值與 callback 管理邊界
```

VirGL 在 guest 與 host 有兩個可分別驗證的介面。 Guest 端從 Gallium map、unmap、queue drain 與 flush 走到 Linux virtio-gpu UAPI。 host 行程端從 VMM 擁有的呼叫端走到 virglrenderer 公開 API。 Kernel、virtqueue 與 VMM device model 串起中間 transport，也決定 guest submission 何時成為 host renderer 呼叫

## DRM／KMS 如何接住 Mesa 與 Xorg

前面的 Big picture 已經沿固定的 vGPU 2D 組態，追蹤 front BO、KMS framebuffer、primary plane、`DIRTYFB` 與 virtual scanout。 後面的 VirGL 章節又加入了另一種 DRM request：Mesa 透過 `EXECBUFFER` 提交 rendering work。 本章改從一般化的 DRM UAPI、object identity 與 completion 觀察兩條路徑

使用者正在等待齒輪轉到下一個角度，application 則可能準備重用剛才的 buffer。 本章先分清 rendering request 與 display request 的 DRM 權限和 object namespace，再沿 ioctl 回傳、fence、swap handoff 與 KMS event 找出 renderer 寫入與 presentation 交付的 completion point

### DRM 同時承接 rendering 與 display request

在前面的 VirGL／DRI3 分支中，Mesa client 與 Xorg 都會向 DRM 發出 request，但兩者需要的權限不同。 Mesa client 需要管理 rendering resources 並提交 GPU work。 Xorg 則要選擇 connector、mode 與 scanout framebuffer，會改變整台機器目前的 display state。 2D drisw 基準路徑的 application rendering 留在 CPU，只有 Xorg 的 display 路徑需要使用 DRM／KMS

Linux 透過 render node 與 primary node 承接這兩類工作。 DRI3 client 通常取得 `/dev/dri/renderD*` 的 rendering fd，Xorg modesetting 則開啟 `/dev/dri/card*`，取得顯示控制權後管理 connector、CRTC、plane 與 KMS state

`DRM_IOCTL_VIRTGPU_EXECBUFFER` 提交 renderer command、BO references 與 synchronization state。 哪份 storage 成為 scanout source，則由 KMS ioctl family 透過 framebuffer registration、plane／CRTC 組態、dirty region、page flip 與 atomic property update 表達

以下程式碼的前半段來自 [`Linux: include/uapi/drm/drm.h:1196`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n1196) 與 [`Linux: include/uapi/drm/drm.h:1223`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n1223)，列出 topology query、initial modeset、page flip 與 dirty update

後半段來自 [`Linux: include/uapi/drm/drm.h:1251`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n1251)，列出 plane、framebuffer 與 atomic operations。 這三組 macros 用來辨認各類 KMS request 的公開 operation identity：

```c
#define DRM_IOCTL_MODE_GETRESOURCES	DRM_IOWR(0xA0, struct drm_mode_card_res)
#define DRM_IOCTL_MODE_GETCRTC		DRM_IOWR(0xA1, struct drm_mode_crtc)
#define DRM_IOCTL_MODE_SETCRTC		DRM_IOWR(0xA2, struct drm_mode_crtc)
...
#define DRM_IOCTL_MODE_PAGE_FLIP	DRM_IOWR(0xB0, struct drm_mode_crtc_page_flip)
#define DRM_IOCTL_MODE_DIRTYFB		DRM_IOWR(0xB1, struct drm_mode_fb_dirty_cmd)
...
#define DRM_IOCTL_MODE_SETPLANE	DRM_IOWR(0xB7, struct drm_mode_set_plane)
#define DRM_IOCTL_MODE_ADDFB2		DRM_IOWR(0xB8, struct drm_mode_fb_cmd2)
...
#define DRM_IOCTL_MODE_ATOMIC		DRM_IOWR(0xBC, struct drm_mode_atomic)
```

`GETRESOURCES`、`GETCRTC` 與相鄰 query operations 讓 X server 先取得裝置公開的 KMS objects。 `SETCRTC` 能建立 legacy display 組態。 `ADDFB2` 以既有 BO 建立一個引用該 storage 的 KMS framebuffer object，pixels 仍保存在原本的 buffer object

後續 display update 有多種形式。 `DIRTYFB` 告知既有 framebuffer 的哪些區域已變更，`PAGE_FLIP` 為 CRTC 選擇下一個 framebuffer，`ATOMIC` 則用 object properties 表達一組要一起檢查與套用的 display state。 實際路徑由 Xorg backend、DRM driver capability 與當下組態決定

### Buffer object 如何被 KMS framebuffer 引用

Mesa 把 texture、render target、command buffer 與 drawable backing 落到 driver resource。 Linux DRM 在 UAPI 邊界以 buffer object 表示裝置可存取的 storage，並在每次 open 建立的 DRM file namespace 內用 GEM handle 找到它。 Handle 只回答「是哪份 storage」，尚未說明顯示引擎應如何讀取其中的 pixels

KMS framebuffer 補上 scanout 所需的 interpretation。 以下程式碼來自 [`Linux: include/uapi/drm/drm_mode.h:694`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm_mode.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n694) 的 `struct drm_mode_fb_cmd2`，用來觀察 framebuffer ID 如何把尺寸、FourCC format 與每個 memory plane 的 GEM handle、pitch、offset 與 modifier 組在一起：

```c
struct drm_mode_fb_cmd2 {
...
	__u32 fb_id;
...
	__u32 width;
...
	__u32 height;
...
	__u32 pixel_format;
...
	__u32 flags;

...
	__u32 handles[4];
...
	__u32 pitches[4];
...
	__u32 offsets[4];
...
	__u64 modifier[4];
};
```

呼叫端送出 `DRM_IOCTL_MODE_ADDFB2` 時，`handles[]` 由送出 request 的 DRM file namespace 解讀。 Kernel 解析對應 BO references，成功後把新的 KMS framebuffer object ID 寫回 `fb_id`。 後續 plane state 以 `fb_id` 引用這個 KMS object。 Mesa 的 `pipe_resource *`、CPU virtual 位址與 guest VirGL resource handle 各自留在原本的 namespace

`width`、`height` 與 `pixel_format` 定義 framebuffer 的可見 layout。 `pitches[]` 表示每列資料跨越的 bytes，`offsets[]` 指出各 memory plane 在 BO 中的起點。 `flags` 啟用 `DRM_MODE_FB_MODIFIERS` 時，`modifier[]` 再表示 linear、tiled 或 compressed 等 layout，所有使用中的 memory planes 採用相同 modifier

同一份 BO 可以有多種用途，只有符合 display engine 限制的 framebuffer interpretation 才能成為 scanout source

Framebuffer registration 建立 KMS object 與 BO references，讓 display state 能穩定引用原本保存 rendering 結果的 storage。 Pixels 何時寫完由 renderer synchronization 回答，哪個 framebuffer 何時成為顯示來源則由 KMS update 與 display completion 回答

### Framebuffer、plane、CRTC、encoder 與 connector

KMS drivers 共同使用 framebuffer、plane、CRTC、encoder 與 connector 表示 display topology。 Xorg 要讓 framebuffer 出現在畫面上，還要把它放進這組 topology。 各個 objects 可沿資料離開 memory 的方向閱讀：

```text
Xorg modesetting
  │
  │  BO handle + format + pitch + offset
  ↓
DRM_IOCTL_MODE_ADDFB2
  │
  │  建立 framebuffer object，回傳 fb_id
  ↓
framebuffer
  │
  │  指定 scanout source 的 storage 與 pixel layout
  ↓
plane
  │
  │  從 framebuffer 選取 source 矩形
  │  放到 CRTC 座標空間的 destination 矩形
  ↓
CRTC
  │
  │  組合啟用的 planes，依 mode 產生 scanout timing
  ↓
encoder
  │
  │  把 CRTC output 接到可用的輸出路徑
  ↓
connector
  │
  │  表示 display endpoint、連線狀態與可用 modes
  ↓
virtio-gpu virtual scanout／host display 邊界
```

Framebuffer 是 pixel source 的 metadata view。 Plane 決定使用哪個 framebuffer、取其中哪一塊 source 矩形，以及把它放到 CRTC 畫面的哪個位置。 Primary plane 通常承載整個桌面，cursor plane 與 overlay plane 則能提供額外的獨立圖層

CRTC 保存目前 mode 與 scanout state，並依固定 timing 讀取已啟用 planes 的內容。 Encoder 描述 CRTC output 能接到哪類輸出路徑，connector 則表示 userspace 可查詢的 display endpoint 與 modes。 Xorg 會從 driver 公開的相容組合中選出可成立的 topology

以下程式碼來自 [`Linux: include/uapi/drm/drm_mode.h:286`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm_mode.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n286) 的 `struct drm_mode_set_plane`，用來觀察 legacy plane request 如何同時引用 plane、CRTC、framebuffer，以及 source／destination 矩形：

```c
struct drm_mode_set_plane {
	__u32 plane_id;
	__u32 crtc_id;
	__u32 fb_id; /* fb object contains surface format type */
	__u32 flags; /* see above flags */

...
	__s32 crtc_x;
	__s32 crtc_y;
	__u32 crtc_w;
	__u32 crtc_h;

...
	__u32 src_x;
	__u32 src_y;
	__u32 src_h;
	__u32 src_w;
};
```

`plane_id` 選擇要更新的 plane，`crtc_id` 指定目的 CRTC，`fb_id` 指向前一步建立的 framebuffer。 `src_*` 使用 16.16 fixed-point 座標描述 framebuffer 取樣範圍，`crtc_*` 則描述該內容在輸出畫面中的位置與大小。 這個結構把 storage interpretation、composition position 與 scanout owner 接在同一次 request 中

Modern atomic KMS 以 object properties 一次表達這組關係。 Plane 的 `FB_ID`、`CRTC_ID`、source 矩形與 destination 矩形 properties，分別回答「讀哪份 framebuffer」與「放到哪個 CRTC 區域」

virtio-gpu 的 connector 表示 guest virtual display endpoint。 Guest kernel 提供 framebuffer、plane、CRTC、encoder 與 connector 的 KMS object model，因此 Xorg 可以沿相同 UAPI 管理 virtual display。 Driver 在 topology 的裝置端把 scanout update 轉成 virtio-gpu command，host emulator 再把結果發布到 host window

### Initial modeset、dirty update、page flip 與 atomic update

VM boot 與 `startx` 階段要先查詢 topology、選擇 mode，並把 framebuffer 接到 plane／CRTC 與 connector 路徑。 這是 initial modeset。 它決定解析度、timing 與 scanout storage，application 開始 rendering 時已經能把 Window content 交給一個有效的 X Screen

後續幀依 storage 與 presentation strategy 選擇更新方式。 軟體 front-buffer 路徑可以持續修改同一份 framebuffer，再以 dirty region 告知 driver 哪些 pixels 已更新。 Double-buffered scanout 可以用 page flip 選擇下一個 framebuffer。 Atomic KMS 則把 framebuffer selection、plane placement、mode 與其他 properties 組成一次 state update

本文的 vGPU 2D 基準組態使用第一種 front-buffer dirty update。 Page flip 與 userspace atomic update 則用來對照 DRI3／Present 與其他 display strategies

以下程式碼來自 [`Linux: include/uapi/drm/drm_mode.h:1287`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm_mode.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n1287) 與 [`Linux: include/uapi/drm/drm_mode.h:1332`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm_mode.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n1332) 的 atomic flags 與 `struct drm_mode_atomic`。 這段用來觀察 test-only、非阻塞、allow-modeset 三種語意，以及 object／property 陣列如何描述一批更新：

```c
...
#define DRM_MODE_ATOMIC_TEST_ONLY 0x0100
...
#define DRM_MODE_ATOMIC_NONBLOCK  0x0200
...
#define DRM_MODE_ATOMIC_ALLOW_MODESET 0x0400

...
#define DRM_MODE_ATOMIC_FLAGS (\
		DRM_MODE_PAGE_FLIP_EVENT |\
		DRM_MODE_PAGE_FLIP_ASYNC |\
		DRM_MODE_ATOMIC_TEST_ONLY |\
		DRM_MODE_ATOMIC_NONBLOCK |\
		DRM_MODE_ATOMIC_ALLOW_MODESET)

struct drm_mode_atomic {
	__u32 flags;
	__u32 count_objs;
	__u64 objs_ptr;
	__u64 count_props_ptr;
	__u64 props_ptr;
	__u64 prop_values_ptr;
	__u64 reserved;
	__u64 user_data;
};
```

`objs_ptr` 指向要更新的 KMS object IDs，`count_props_ptr` 記錄每個 object 帶有多少 properties，`props_ptr` 與 `prop_values_ptr` 則形成 property ID／value pairs。 一次 request 因而可以同時描述多個 plane、CRTC 與 connector 的新 state

`DRM_MODE_ATOMIC_TEST_ONLY` 只驗證 proposed state，不套用 display update。 正式 submit 也會先檢查完整 state。 Format、plane／CRTC routing、mode 或 resource 限制不成立時，request 回傳錯誤，現有 display state 維持不變

`DRM_MODE_ATOMIC_NONBLOCK` 讓 ioctl 在 update 排入後回傳。 [`Linux: DRM_MODE_PAGE_FLIP_EVENT`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/include/uapi/drm/drm_mode.h?id=0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53#n1084) 會在 page flip 完成時要求 `DRM_EVENT_FLIP_COMPLETE` event。 Atomic request 會為納入這次 commit 的每個 CRTC 送出一個 event

Page flip 的同步更新通常配合 vblank 生效，`DRM_MODE_PAGE_FLIP_ASYNC` 則允許 asynchronous flip。 這個 event 提供對應 CRTC 的 flip completion。 Buffer reuse 仍依 renderer 與 presentation synchronization 判斷

`DRM_MODE_ATOMIC_ALLOW_MODESET` 允許套用期間可能產生暫時可見瑕疵、且可能比 page flip 花費更久的 KMS update。 Driver 與硬體限制決定某項 update 是否需要這個 flag，mode 或 routing 變更是常見案例

rendering fence 標記 producer 完成 rendering work。 X server／backend 的 presentation completion 記錄幀交付與 buffer reuse state。 requested KMS event 則標記指定 CRTC 的 display flip 已完成

接下來的完整 workload trace 會按時間重走 context、draw、submit、swap 與 teardown

## 完整 OpenGL workload trace

最後回到開頭的 `glxgears` 情境，從使用者按下 Enter 開始，依時間重走一次代表性的 OpenGL workload。 Application 建立齒輪 Window 與 current GLX context，準備 shader／resource state，由 Mesa 產生一幀 rendering，再以 `glXSwapBuffers()` 交給 X server

2D drisw 基準路徑會在 application 行程內算出齒輪 pixels，透過 put-image-style pixel handoff 更新 X drawable。 VirGL 3D 路徑則會在 rendering 階段把 renderer work 經 execbuffer 交給 DRM／kernel，presentation 路徑另外以 GLX drawable、buffer 與 synchronization state 交付同一幀

前面的 overview 主要追蹤 pixels、renderer work 與 owner。 這一次改沿函式、object references、失敗清理與 completion points 重走同一條時間線，並以 `glShaderSource()`、resource objects 與 `glDrawArrays()` 放大 Mesa 內部的代表性 workload

### Context 初始化 trace

外層 GLX application 生命週期在 X11 Window 已存在後，先建立可供後續 rendering、swap、completion 與 teardown 共用的 current context。 GLX 提供多種 context 建立入口。 以下選擇 `glXCreateContextAttribsARB()` 具體追蹤一條 direct context 建立路徑，觀察 GLVND 如何選擇 vendor、Mesa GLX 如何建立 client-side `glx_context`，以及 DRI frontend 與 State Tracker 如何接出 `pipe_context` 和 `gl_context`

Context 建立成功時，這組 object graph 已可供 application 綁定。 `glXMakeContextCurrent()` 成功回傳後，呼叫端執行緒會在 GLX TLS 看到該 `glx_context`，Mesa GLAPI stub 也會透過這個執行緒的 dispatch table 到達新的 `gl_context`。 current state 建立完成後，外層時間線便進入 rendering

#### Application 到 GLX vendor

第一個問題是「新 context 尚未存在時，誰決定 `glXCreateContextAttribsARB()` 屬於哪個 vendor」。 Mesa vendor 函式庫先透過 `__glx_Main()` 和 GLVND 交換 ABI table。 `exports` 是 GLVND 提供給 Mesa 的反向介面，`imports` 則由 Mesa 填入 screen support、函式指標查找與 dispatch-index callback

`__glx_Main()` 的完整程式碼與 registration callgraph 已在前文「GLVND 選到 Mesa vendor／Vendor ABI registration」單元展開。 放回這條時間線，ABI major 必須相同且 GLVND minor 不得過舊。 首次成功 registration 會保存 `exports`，並把 screen support、函式指標查找與 dispatch-index callbacks 填入 `imports`

ABI registration 完成後，context 建立 dispatch 再從 FBConfig mapping 找 `__GLXvendorInfo`。 固定版本的 [`Mesa: src/glx/g_glxglvnddispatchfuncs.c:159`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/g_glxglvnddispatchfuncs.c#L159) 會取得 vendor 對應的 `CreateContextAttribsARB` 函式指標，呼叫後再把回傳的 `GLXContext` 加入 context-to-vendor mapping。 後續只帶 context handle 的 GLX 呼叫才能穩定回到同一個 vendor

這個階段的 owner 不可混合。 GLVND 擁有 vendor dispatch infrastructure 與 object mapping。 Mesa vendor 建立的 `glx_context` 則是 Mesa client-side object。 FBConfig 只提供選擇 vendor 所需的既有 identity，沒有轉移給新 context

失敗在這裡有三個不同時點。 ABI major 不同或 GLVND minor 太舊時，`__glx_Main()` 直接回傳 `False`。 找不到 FBConfig 對應 vendor 或函式指標時，dispatch wrapper 回傳 `None`。 vendor context 已建立卻新 mapping 新增失敗時，固定版本的註解還明確留下「是否應擴充 dispatch index 以呼叫 destroy」的未解清理問題。 因此 trace 不將 `None` 一律解釋為「所有下層 object 都已回收」

這一步的 completion 是 Mesa vendor 已選定，而且成功的 `GLXContext` 已有 vendor mapping。 它尚未證明 DRI context 建立完整，也未改變任何執行緒的 current dispatch

#### DRI／State Tracker／Gallium driver

Mesa GLX wrapper 選擇 direct 路徑後，`dri_create_context_attribs()` 把 GLX profile、version、flags、reset strategy、release behavior 與 sharing 條件轉成 DRI attributes。 Gallium DRI frontend 的 `dri_create_context()` 再把 visual 與 `st_share` 交給 `st_api_create_context()`

以下程式碼來自 [`Mesa: src/mesa/state_tracker/st_manager.c:964`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_manager.c#L964) 的 `st_api_create_context()`，用來確認 `pipe_context` 與 `st_context` 的建立順序，以及第二步失敗時由誰回收先建立的 driver context：

```c
struct st_context *
st_api_create_context(struct pipe_frontend_screen *fscreen,
                      const struct st_context_attribs *attribs,
                      enum st_context_error *error,
                      struct st_context *shared_ctx)
{
...
   pipe = fscreen->screen->context_create(fscreen->screen, NULL,
                                          PIPE_CONTEXT_PREFER_THREADED |
                                          lod_bias_flag |
                                          attribs->context_flags);
   if (!pipe) {
      *error = ST_CONTEXT_ERROR_NO_MEMORY;
      return NULL;
   }

   st_visual_to_context_mode(&attribs->visual, &mode);
   if (attribs->visual.color_format == PIPE_FORMAT_NONE)
      mode_ptr = NULL;
   st = st_create_context(attribs->profile, pipe, mode_ptr, shared_ctx,
                          &attribs->options, no_error,
                          !!fscreen->validate_egl_image);
   if (!st) {
      *error = ST_CONTEXT_ERROR_NO_MEMORY;
      pipe->destroy(pipe);
      return NULL;
   }
...
}
```

`fscreen->screen` 是 DRI screen 先前建立的 `pipe_screen`，此處只借用它呼叫 callback。 新 `pipe_context` 屬於此次 context 建立，一旦 `st_create_context()` 成功，就由 `st_context::pipe` 長期持有。 DRI frontend 再把成功的 `st_context` 存入 `dri_context::st`，並以 `frontend_context` 建立反向連結

在 VirGL screen 上，`context_create` slot 是前文已驗證的 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1709`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1709) `virgl_context_create()`。 它建立 `virgl_context`、command buffer、uploader、transfer queue 與整張 `pipe_context` callback table。 這是 Gallium rendering context，與前文「VirGL guest driver 與 winsys」章節的 `virgl_init_context()` 所建立的 DRM file context 分屬不同生命週期

sharing 也有清楚邊界。 DRI `sharedContextPrivate` 只用來找到舊 `dri_context::st`，State Tracker 再由 `shared_ctx` 取得 Mesa share group。 新 context 可共用 texture、buffer 與 shader namespace，卻不共用 `pipe_context` command buffer、current draw/read framebuffer 或執行緒區域 dispatch pointer

失敗順序反映 ownership 順序。 driver 無法建立 `pipe_context` 時，State Tracker 尚無需回收。 `pipe_context` 已成功而 `st_create_context()` 失敗時，片段立即呼叫 `pipe->destroy(pipe)`。 之後的 version check 失敗則由 `st_destroy_context()` 回收已組好的 Mesa core 與 pipe state，錯誤會逐層轉成 DRI 再轉成 GLX error

此 H4 的 completion 是 `glx_context`、`dri_context`、`st_context`、`gl_context` 與 driver `pipe_context` 已串成一個可銷毀的 ownership graph。 這個 graph 還沒有 drawable reference，command buffer 也尚未因 application draw 而增加內容

#### Make-current 與 TLS dispatch

`glXMakeContextCurrent()` 將「存在的 context」變成「呼叫執行緒的 current context」。 direct GLX 路徑先找 draw 與 read drawable，DRI frontend 取得對應 `dri_drawable` reference，State Tracker 依 drawable identity 建立或重用 winsys framebuffer，最後呼叫 `_mesa_make_current()`

以下程式碼來自 [`Mesa: src/mesa/main/context.c:1451`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1451) 的 `_mesa_make_current()`，用來追蹤執行緒區域 current context、GLAPI dispatch table 與 draw／read framebuffer references 的更新順序：

```c
GLboolean
_mesa_make_current(struct gl_context *newCtx,
                   struct gl_framebuffer *drawBuffer,
                   struct gl_framebuffer *readBuffer)
{
...
   if (!newCtx) {
      _mesa_glapi_set_dispatch(NULL);  /* none current */
      /* We need old ctx to correctly release Draw/ReadBuffer
       * and avoid a surface leak in st_renderbuffer_delete.
       * Therefore, first drop buffers then set new ctx to NULL.
       */
      if (curCtx) {
         _mesa_reference_framebuffer(&curCtx->WinSysDrawBuffer, NULL);
         _mesa_reference_framebuffer(&curCtx->WinSysReadBuffer, NULL);
      }
      _mesa_glapi_set_context(NULL);
      assert(_mesa_get_current_context() == NULL);
   }
   else {
      _mesa_glapi_set_context((void *) newCtx);
      assert(_mesa_get_current_context() == newCtx);
      _mesa_set_dispatch(newCtx, newCtx->GLApi);

      if (drawBuffer && readBuffer) {
         assert(_mesa_is_winsys_fbo(drawBuffer));
         assert(_mesa_is_winsys_fbo(readBuffer));
         _mesa_reference_framebuffer(&newCtx->WinSysDrawBuffer, drawBuffer);
         _mesa_reference_framebuffer(&newCtx->WinSysReadBuffer, readBuffer);
...
      }
      ...
   }
   ...
   return GL_TRUE;
}
```

程式碼特別顯示 unbind 時的先後。 Mesa 先將 dispatch 改為無 current table，接著用舊 `curCtx` 解除 draw/read framebuffer reference，最後才清 current-context pointer。 如果提前丟掉 `curCtx`，State Tracker renderbuffer 清理就失去解除 surface reference 所需的 context

bind 分支則先安裝 `newCtx`，再依 `newCtx->GLApi` 選擇 dispatch table，之後才接上 winsys framebuffer。 GLX 外層的 [`Mesa: src/glx/glxcurrent.c:106`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcurrent.c#L106) `MakeContextCurrent()` 只在 backend bind 成功後更新 `__glX_tls_Context`，所以失敗的 bind 不會向 application 公布一個半完成 current state

失敗要依 unbind 前後分成兩組。 Context XID 已失效，或 draw／read 只有一個為 `None` 時，函式在取得 lock 前就回傳，舊 current context 仍然有效

完成這些檢查後，GLX 會先 unbind `oldGC` 並執行 `__glXSetCurrentContextNull()`，才檢查新 context 是否已在其他執行緒 current，並呼叫 backend bind。 因此 `BadAccess`、drawable lookup、winsys framebuffer 配置或 visual compatibility 在這個階段失敗時，呼叫端執行緒會留下 null current state

completion 可由三個相互呼應的 state 確認：GLX TLS 指向新 `glx_context`，Mesa GLAPI TLS 指向新 `gl_context`，`Dispatch.Current` 指向該 context 對應的 API table。 之後 `glShaderSource()` 或 `glDrawArrays()` 才能在不帶 `Display *` 與 `GLXContext` 參數的情況下，取得這次 workload 的 `gl_context`

```callgraph
Application 與 Mesa GLX
=================================================
[Mesa: src/glx/create_context.c:46] glXCreateContextAttribsARB(dpy, config, share, direct, attrib_list)
  │
  ├─ 若 display／screen／FBConfig 驗證失敗
  │    └─ 回傳 `NULL`，沒有 context object 交給 application
  └─ 成功選到 Mesa direct vendor 路徑
       └─ [Mesa: src/glx/dri_common.c:795] dri_create_context_attribs(...)
            └─ `glx_context->driContext = dri_screen->createContextAttribs(...)`
  ↓
Mesa Gallium DRI frontend
=================================================
[Mesa: src/gallium/frontends/dri/dri_context.c:46] dri_create_context(...)
  │
  └─ [Mesa: src/mesa/state_tracker/st_manager.c:964] st_api_create_context(stapi, smapi, attribs, ...)
       ├─ driver `pipe_screen->context_create(...)` 失敗
       │    └─ 回收已配置的 context wrapper，回傳 error
       └─ 成功
            ├─ 建立 `pipe_context`
            ├─ 建立 `st_context`
            └─ 建立 `gl_context`
  ↓
Application make-current request
=================================================
[Mesa: src/glx/glxcurrent.c:106] MakeContextCurrent(dpy, draw, read, gc, opcode)
  │
  ├─ `gc->xid == None` 或 draw／read 只有一個為零
  │    └─ unbind 前回傳 `False`，舊 current state 保持有效
  │
  ├─ `oldGC != dummyContext`
  │    └─ `oldGC->vtable->unbind(oldGC); oldGC->currentDpy = NULL`
  │         ↓
  ├─ `__glXSetCurrentContextNull()`
  │    └─ 後續失敗都留下 null current state
  │
  ├─ `gc->currentDpy != NULL`
  │    └─ 送 `BadAccess` 並回傳 `False`
  │
  └─ `gc->vtable->bind(gc, draw, read)`
       ├─ 失敗：`ret = GL_FALSE`
       └─ 成功：[Mesa: src/gallium/frontends/dri/dri_context.c:304] dri_make_current(ctx, draw, read)
  ↓
[Mesa: src/mesa/state_tracker/st_manager.c:1146] st_api_make_current(st, stdrawi, streadi)
  │
  ├─ framebuffer 建立失敗
  │    └─ `return false`
  └─ 成功
       ├─ [Mesa: src/mesa/main/context.c:1451] _mesa_make_current(st->ctx, stdraw, stread)
       ├─ 設定 GLAPI context／dispatch TLS
       └─ GLX 將 `gc`、draw 與 read identity 寫入執行緒的 current state
            // 後續 OpenGL 入口才能經 dispatch table 到達新 `gl_context`
```

### Shader 與 resource 初始化 trace

GLX application 已建立 current context，接下來要準備這一幀使用的 shader 與 resource。 為了看清這些 object 如何成為 driver state，以下另外追蹤一組包含 vertex／fragment GLSL、shader／program、buffer、VAO、texture、sampler 與 FBO 的 OpenGL 操作，觀察 GL name、binding、format 與 source 如何成為 shader state、Gallium resource、sampler view 與 render-target surface

各個 object 有自己的建立時點。 shader create callback 可以在 link 或首次需要 variant 時產生 driver handle，resource storage 可在定義 image 或 buffer data 時建立，State Tracker 則等到驗證 atom 執行才把 current bindings 組成 `pipe_context` state。 Driver state 準備完成後，這些路徑會匯回外層 rendering 流程

#### Shader source、compile、link 與 NIR

shader trace 的第一個長期 owner 是 `gl_shader`。 `glShaderSource()` 先將 application 提供的多段文字複製並合併成 Mesa 自己配置的 source，再由前文已驗證的 [`Mesa: src/mesa/main/shaderapi.c:1193`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L1193) `set_shader_source()` 替換 `gl_shader::Source`

傳入的字串與字串陣列始終由 application 擁有。 API 回傳後可以修改或釋放，之後的 compiler 只讀 Mesa 的內部副本

以下程式碼來自 [`Mesa: src/mesa/main/shaderapi.c:1237`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/shaderapi.c#L1237) 的 `_mesa_compile_shader()`，用來比較 source 缺失與進入 GLSL compiler 兩條路徑如何更新 `gl_shader` state：

```c
void
_mesa_compile_shader(struct gl_context *ctx, struct gl_shader *sh)
{
...
   if (!sh->Source) {
      /* If the user called glCompileShader without first calling
       * glShaderSource, we should fail to compile, but not raise a GL_ERROR.
       */
      sh->CompileStatus = COMPILE_FAILURE;
   } else {
      if (ctx->_Shader->Flags & (GLSL_DUMP | GLSL_SOURCE)) {
         _mesa_log("GLSL source for %s shader %d:\n",
                 _mesa_shader_stage_to_string(sh->Stage), sh->Name);
         _mesa_log_direct(sh->Source);
      }

      MESA_TRACE_FUNC();

      ensure_builtin_types(ctx);

      /* this call will set the shader->CompileStatus field to indicate if
       * compilation was successful.
       */
      _mesa_glsl_compile_shader(ctx, sh, NULL, false, false, false);
      ...
   }
...
}
```

compile 成功時的 NIR 仍屬於單一 `gl_shader`。 application 接著 attach shader 到 `gl_shader_program`，`glLinkProgram()` 才檢查所有 attached shader 的 compile status，依 stage 合併 compilation unit，檢查跨 stage 介面，並將 NIR clone 到 linked `gl_program`。 同一個 shader object 因而可被不同 program attach，各次 link 可各自改寫 clone 而不破壞 per-shader NIR

State Tracker 的 [`Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:438`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_glsl_to_nir.cpp#L438) `st_link_glsl_to_nir()` 再依 `pipe_screen` caps 做 common lowering，整理 program resources、stream output 與 parameter，並將 `pipe_shader_state::type` 設為 `PIPE_SHADER_IR_NIR`。 `st_create_nir_shader()` 依 NIR stage 選擇 `create_vs_state`、`create_fs_state` 與其他 callback，driver 在該邊界取得交付 NIR 的 ownership，State Tracker 保存的則是 callback 回傳的 opaque handle

失敗必須保留可查詢的 state。 compile 失敗後 `gl_shader` 仍存在，application 可查 `CompileStatus` 與 `InfoLog`，重新指定 source 再 compile。 link 失敗則將 program `LinkStatus` 設為失敗，不安裝這次未完成的 executable。 driver shader create 回傳空值時，新 variant 不可當成有效 handle，已轉移或 clone 的 NIR 也要按 callback contract 回收

此 H4 要到下列條件都成立才算 completion：program `LinkStatus` 成功、每個使用中 stage 都有 linked `gl_program::nir`，而且 State Tracker 能為目前 driver 建立對應 shader state。 這時 program 才具備 draw 驗證所需的 executable identity

#### Buffer、VAO、texture、sampler 與 FBO

Application 呼叫 `glGenBuffers()` 或 `glCreateBuffers()` 時，先取得的是 OpenGL object identity； 等到 `glBufferData()`、texture image definition 或 framebuffer setup 發生後，Mesa 才會逐步建立實際的 driver storage 與 attachment state。 因此，GL name 已存在不代表 Gallium resource 已經配置完成

沿著這組操作往下看時，需要分開追蹤 GL object identity 與 driver storage identity。 VAO、sampler 與 FBO 主要保存 binding 或 reference，buffer 與 texture 才會連到真正承載資料的 `pipe_resource`

texture object 保存 target、image state 與 `pipe_resource` storage，sampler object 只保存 filtering、wrap、LOD 與 compare state。 將 sampler 綁定到 texture unit 不會複製 texture storage。 FBO 再以 attachment reference 指向 texture image 或 renderbuffer，State Tracker 在 framebuffer atom 將這些 attachment 轉成 `pipe_surface`

以下程式碼來自 [`Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:111`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_atom_framebuffer.c#L111) 的 `st_update_framebuffer_state()`，用來追蹤 current GL draw framebuffer 如何轉成 Gallium framebuffer 尺寸、samples 與 attachment state：

```c
void
st_update_framebuffer_state( struct st_context *st )
{
   struct gl_context *ctx = st->ctx;
   struct pipe_framebuffer_state framebuffer = {0};
   struct gl_framebuffer *fb = st->ctx->DrawBuffer;
   struct gl_renderbuffer *rb;
   GLuint i;

   /* Window framebuffer changes are received here. */
   st_manager_validate_framebuffers(st);

   st_flush_bitmap_cache(st);
   st_invalidate_readpix_cache(st);

   st->state.fb_orientation = _mesa_fb_orientation(fb);

   /**
    * Quantize the derived default number of samples:
    *
    * A query to the driver of supported MSAA values the
    * hardware supports is done as to legalize the number
    * of application requested samples, NumSamples.
    * See commit eb9cf3c for more information.
    */
   fb->DefaultGeometry._NumSamples =
      framebuffer_quantize_num_samples(st, fb->DefaultGeometry.NumSamples);

   framebuffer.width  = _mesa_geometric_width(fb);
   framebuffer.height = _mesa_geometric_height(fb);
   framebuffer.samples = _mesa_geometric_samples(fb);
   framebuffer.layers = _mesa_geometric_layers(fb);
   framebuffer.resolve = fb->resolve;
...
}
```

後續 loop 對每個 color draw buffer 取 `gl_renderbuffer`，必要時更新 render-to-texture surface，再把 `rb->surface` 填入 `framebuffer.cbufs`。 depth/stencil attachment 以同樣原則形成 `zsbuf`，最後透過 CSO cache 呼叫 `set_framebuffer_state`。 current FBO 的 application identity 不會傳給 driver，driver 只看到 Gallium surface 與幾何資訊

buffer 與 VAO 也在 draw atom 做類似轉換。 前文的 [`Mesa: src/mesa/main/arrayobj.c:885`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/arrayobj.c#L885) `bind_vertex_array()` 用 `_mesa_reference_vao()` 替換 `ctx->Array.VAO`，`st_atom_array.cpp` 再依 current VAO 組成 vertex elements 與 vertex buffers。 texture sampler-view atom 從 texture unit 取 texture object 與 sampler state，建立或重用 `pipe_sampler_view`，再以 `set_sampler_views` 與 `bind_sampler_states` 交給 driver

ownership 由 reference graph 維持，而非只看 GL name。 `glDeleteBuffers()` 或 `glDeleteTextures()` 移除 namespace entry 並解除 application-visible binding，VAO、FBO、sampler view 或其他 context 若仍持有 reference，底層 `pipe_resource` 可繼續存活。 surface 與 sampler view 也會持有 resource reference，所以銷毀 view 時才解除該邊

失敗可在不同階段發生。 GL name 或 object wrapper 配置失敗會記錄 `GL_OUT_OF_MEMORY`。 `pipe_screen::resource_create` 回傳空值時，GL object 仍沒有 storage。 FBO attachment 雖然都有 object，format、尺寸或 sample count 不相容時仍可以 incomplete，draw 驗證會在 driver callback 前停下。 sampler view 配置失敗則留下未建立 view 的 binding 結果

completion 是 draw 會用到的 GL names 已登記在正確的 context 或 share-group namespace，storage 已有有效 `pipe_resource`，VAO 與 FBO 持有所需 reference，而 State Tracker 驗證能從 current state 建立 driver views。 此處仍不要求 command buffer 已提交

#### VirGL resource／shader command

VirGL 路徑將上一節的 Gallium object 轉成 guest command stream 中的 identity。 `virgl_resource_create_front()` 先建立 `virgl_resource` wrapper、計算 layout 與 bind flags，再呼叫 winsys `resource_create`。 classic resource ioctl 與 blob resource ioctl 都會產生 `virgl_hw_res`，但後續 command 只透過同一張 winsys contract 取得 handle

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_encode.c:710`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_encode.c#L710) 的 `virgl_emit_shader_header()`，用來確認 shader object handle、stage 與 token metadata 在 VirGL command stream 中的 layout：

```c
static void virgl_emit_shader_header(struct virgl_context *ctx,
                                     uint32_t handle, uint32_t len,
                                     uint32_t type, uint32_t offlen,
                                     uint32_t num_tokens)
{
   virgl_encoder_write_cmd_dword(ctx, VIRGL_CMD0(VIRGL_CCMD_CREATE_OBJECT, VIRGL_OBJECT_SHADER, len));
   virgl_encoder_write_dword(ctx->cbuf, handle);
   virgl_encoder_write_dword(ctx->cbuf, type);
   virgl_encoder_write_dword(ctx->cbuf, offlen);
   virgl_encoder_write_dword(ctx->cbuf, num_tokens);
}
```

shader object handle 不是 resource handle，也不是 kernel BO handle。 它只是 VirGL command protocol 中辨識 shader object 的 32-bit token。 State Tracker 得到的 opaque shader state 是這個整數轉成的 pointer-shaped value，bind 與 delete command 再將它轉回整數寫入 command stream

resource 使用兩個 handle，用途仍需分開。 前文的 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.h:40`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.h#L40) 證明 `virgl_hw_res` 同時有 `res_handle` 與 `bo_handle`

`res_handle` 由 `virgl_drm_emit_res()` 寫進 renderer 可見的 command slot，正常配置時 `bo_handle` 也會加入 execbuffer 的 BO handle list。 同一個 resource 因此在兩份不同的 command submission data 中各有一個 identity，但 command dword 本身不證明 list entry 已配置成功

ownership 邊界位於 command 與 resource reference 之間。 resource state command 不擁有 `pipe_resource`

例如 sampler view、vertex buffer、uniform buffer 與 framebuffer surface 的 VirGL wrapper 會持有 Gallium reference。 handle-list 配置成功時，winsys 另將 `virgl_hw_res` 加入 cbuf reference list，保護期只到 submit ioctl 回傳

`virgl_drm_clear_res_list()` 隨後立即解除 userspace reference，與 fence 生命週期無關。 submission 成功後由 kernel 保留執行所需的 BO，sync-file fence 本身只擁有 fd

失敗包含 resource 配置、handle-list 擴充與 shader encoding 三條支線。 winsys resource ioctl 失敗時 `resource_create` 回傳空值，`res_handle` 與 `bo_handle` 都不可使用。 relocation／handle-list `REALLOC` 失敗時，winsys 只記錄訊息，已寫入的 command dword 不會回復，encoder 也收不到錯誤

`virgl_shader_encoder()` 在固定 checkout 並沒有一條完整的「失敗就釋放所有暫時 token」路徑。 `nir_to_tgsi_options()` 的結果未檢查空值。 NIR 路徑的 transform 回傳空值時會遺留 `ntt_tokens`，encode 失敗時則遺留 `new_tokens`。 這三項是固定版本的失敗／清理缺口

command buffer 空間不足時可先 flush 舊 cbuf 再繼續 encoding。 這是 command segmentation，不是 shader compile 失敗

此 H4 的 completion 是 VirGL resource 已有 guest `virgl_hw_res`，shader 已有 protocol object handle，相關 create/bind state 已編碼或可在首次 draw 時 re-emit。 這些 command 還在 guest `virgl_cmd_buf`，沒有因 encoder 函式回傳就自動跨越 Linux UAPI

```callgraph
Mesa OpenGL shader 與 link 階段
=================================================
[Mesa: src/mesa/main/shaderapi.c:1193] set_shader_source(shader, source, source_hash)
  │
  ├─ 前一輪 compile 被 cache skip 且還沒有 fallback
  │    └─ 舊 `Source` 移到 `FallbackSource`，新 source 成為目前輸入
  └─ 一般路徑
       └─ `free(shader->Source); shader->Source = source`
            // Mesa 將內部副本裝進 `gl_shader`。 application 仍擁有原字串
  ↓
後續 application `glCompileShader()` 階段
  ↓
[Mesa: src/mesa/main/shaderapi.c:1237] _mesa_compile_shader(ctx, shader)
  │
  ├─ `shader->Source == NULL`
  │    └─ `CompileStatus = COMPILE_FAILURE`
  └─ source 存在
       └─ `_mesa_glsl_compile_shader(...)` 產生 per-shader NIR 與 info log
  ↓
後續 application attach + `glLinkProgram()` 階段
  ↓
[Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:766] st_link_shader(ctx, prog)
  │
  ├─ attached shader 的 `CompileStatus` 失敗
  │    └─ `linker_error(...)`，保留可查詢的 program info log
  └─ `prog->data->LinkStatus` 仍成功
       └─ `st_link_glsl_to_nir(ctx, prog)` 建立各 stage 的 linked `gl_program::nir`
  ↓
後續在 state 驗證期間建立 driver variant
  ↓
[Mesa: src/mesa/state_tracker/st_program.c:490] st_create_nir_shader(st, state)
  │
  └─ [Mesa: src/mesa/state_tracker/st_program.c:542] 依 NIR stage 呼叫 `pipe->create_*_state`
       ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:769] virgl_create_vs_state(ctx, state)
  └─ [Mesa: src/gallium/drivers/virgl/virgl_context.c:695] virgl_shader_encoder(ctx, state, stage)
  │
  ├─ NIR conversion 失敗
  │    └─ `ntt_tokens = tokens = nir_to_tgsi_options(...)` 後沒有 `NULL` check
  │         // fixed-checkout 缺口：空 `tokens` 仍會傳進 `virgl_tgsi_transform()`
  ├─ `new_tokens = virgl_tgsi_transform(...)` 回傳 `NULL`
  │    └─ 直接 `return NULL`，沒有 `FREE(ntt_tokens)`
  │         // fixed-checkout 清理缺口：遺留 NIR-to-TGSI tokens
  ├─ `ret = virgl_encode_shader_state(...)` 且 `ret != 0`
  │    ├─ `FREE(ntt_tokens)`
  │    └─ `return NULL`，沒有 `FREE(new_tokens)`
  │         // fixed-checkout 清理缺口：遺留 transformed tokens
  └─ encode 成功
       ├─ `FREE(ntt_tokens); FREE(new_tokens)`
       └─ `return (void *)(uintptr_t)handle`
            // 最終結果：State Tracker 保存 driver opaque handle，create-object command 留在 cbuf

Mesa State Tracker framebuffer binding
=================================================
[Mesa: src/mesa/state_tracker/st_atom_framebuffer.c:111] st_update_framebuffer_state(st)
  │
  ├─ 對每個 color／depth attachment 建立或參照 `pipe_surface`
  └─ `cso_set_framebuffer(st->cso_context, &framebuffer)`
       // FBO storage 轉成 driver 可見的 render-target surfaces
  ↓
[Mesa: src/gallium/auxiliary/cso_cache/cso_context.c:775] cso_set_framebuffer(cso, fb)
  │
  ├─ cached framebuffer 與 `fb` 相同：不重送 callback
  └─ state 改變：`pipe->set_framebuffer_state(pipe, fb)`
       ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:463] virgl_set_framebuffer_state(ctx, state)
  │
  ├─ attachment 改變：刪除舊 surface handle，為新 `pipe_surface` 編碼 object
  ├─ `util_copy_framebuffer_state()` 保存 resource references
  ├─ [Mesa: src/gallium/drivers/virgl/virgl_encode.c:895] virgl_encoder_set_framebuffer_state(...)
  └─ `virgl_attach_res_framebuffer(vctx)`
       // 最終結果：surface handles 寫入 cbuf，相關 `virgl_hw_res` 加入 submission reference list
```

### Draw、flush 與 submit trace

application 已準備好 current OpenGL state 與 draw inputs，外層時間線來到 rendering。 以下選擇 `glDrawArrays()` 具體觀察驗證與 driver handoff：GLAPI stub 依 current context 的執行緒區域 dispatch table 進入 `_mesa_DrawArrays()`，Mesa core 更新 dirty derived state 並執行 API 驗證，State Tracker 再處理這次 draw 依賴的 atoms，最後組成 Gallium `pipe_draw_info`

2D drisw 軟體基準路徑先由 softpipe 或 llvmpipe 在 guest CPU 執行這份 draw，結果是留在 Mesa client-side color buffer 的 completed pixels，後續 flush／pixel handoff 才把它們交給 X server。 切到 VirGL 3D 後，相同的 Gallium draw description 會改由 driver 編進 guest command buffer。 代表性的 explicit `glFlush()` 路徑再把 State Tracker 延遲工作、VirGL transfer queue、command bytes 與 BO list 推到 ioctl UAPI

#### GLAPI 入口到 State Tracker

以下程式碼來自 [`Mesa: src/mesa/main/draw.c:1369`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L1369) 的 `_mesa_DrawArrays()`，用來追蹤公開 draw 入口在 driver handoff 前執行的 frontend state update 與 API 驗證：

```c
void GLAPIENTRY
_mesa_DrawArrays(GLenum mode, GLint start, GLsizei count)
{
   GET_CURRENT_CONTEXT(ctx);
   FLUSH_FOR_DRAW(ctx);

   _mesa_set_varying_vp_inputs(ctx, ctx->VertexProgram._VPModeInputFilter &
                               ctx->Array._DrawVAO->_EnabledWithMapMode);
   if (ctx->NewState)
      _mesa_update_state(ctx);

   if (!_mesa_is_no_error_enabled(ctx) &&
       !_mesa_validate_DrawArrays(ctx, mode, count))
      return;

   if (0)
      check_draw_arrays_data(ctx, start, count);

   _mesa_draw_arrays(ctx, mode, start, count, 1, 0);

   if (0)
      print_draw_arrays(ctx, mode, start, count);
}
```

驗證只在不是 no-error context 時呼叫，但 no-error 不會繞過後續建立 draw state 所需的資料轉換。 普通 context 上，`_mesa_validate_DrawArrays()` 檢查 mode、count、program、VAO、framebuffer completeness 與 valid-to-render cache。 其中任一條件失敗就記錄對應 GL error 並回傳，driver 不會看到這次 draw

`_mesa_draw_arrays()` 是下一個層次。 前文已驗證的 [`Mesa: src/mesa/main/draw.c:1142`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/draw.c#L1142) 先略過 zero-count 或 zero-instance draw，再以 stack-local `pipe_draw_info` 保存 primitive mode、index 形態、instance count、min/max index 與 start instance。 `pipe_draw_start_count_bias` 另存 start 與 count，讓同一張 Gallium contract 可處理單筆或多筆 draw

`ST_PIPELINE_RENDER_STATE_MASK(mask)` 列出這條 pipeline 需要的 State Tracker atoms。 `st_prepare_draw()` 先 assert Mesa core `NewState` 已清為零，清掉 bitmap 與 read-pixels cache，再以 `st_validate_state(st, mask)` 只執行 dirty 而且 active 的 atom。 framebuffer、shader、sampler view、vertex buffer 與其他 CSO 因而在 `DrawGallium` 前已經轉成 driver state

ownership 邊界位於 call stack。 這些 `pipe_draw_info` 與 state mask 只在 stack 借給下層。 driver 若需在 callback 回傳後保留資訊，必須複製必要欄位或將它們編碼進 driver 所擁有的 work queue。 VAO、FBO、shader 與 resource 的生命週期則由 context 與 Gallium reference graph 維持，不由這兩個 stack struct 擁有

失敗路徑的 completion 可以很精確地劃線。 驗證失敗或 zero-count 提前回傳時，這次 API 呼叫已完成，而 driver work 數量為零。 `st_prepare_draw()` 與 `ctx->Driver.DrawGallium()` 回傳時，必要 state 已交給 `pipe_context` 且 driver callback 已被呼叫。 submission 由 flush callback 推進，rendering completion 由 fence 或 driver completion primitive 確認

#### Gallium driver draw

`st_draw_gallium()` 只取 `st_context::cso_context` 並呼叫 `cso_draw_vbo()`。 CSO helper 處理必要 fallback 與 cached binding，最終以相同 `pipe_draw_info` 呼叫 current `pipe_context::draw_vbo` callback。 callback table 在 context 建立已經固定，State Tracker 不用依 driver name 分支

軟體 driver 的 completion 形狀與 VirGL 不同。 [`Mesa: src/gallium/drivers/softpipe/sp_draw_arrays.c:61`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/softpipe/sp_draw_arrays.c#L61) `softpipe_draw_vbo()` 直接取得 CPU-visible vertex/index storage，更新 derived state，呼叫 draw module，再解除 mapped input

[`Mesa: src/gallium/drivers/llvmpipe/lp_draw_arrays.c:54`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/llvmpipe/lp_draw_arrays.c#L54) 的 `llvmpipe_draw_vbo()` 亦建立 mapped inputs 與 sampling／image state，backend 使用 llvmpipe compiled pipeline 與 worker machinery 直接在 CPU 生產 rasterized 結果。 VirGL 分支則產生可提交的 command stream

以下程式碼來自 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1011`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1011) 的 `virgl_draw_vbo()` 收尾，用來追蹤第一筆 draw 的 resource-state rebuild、draw encoding 與暫存 index-buffer reference 清理：

```c
static void
virgl_draw_vbo(
   struct pipe_context *ctx,
   const struct pipe_draw_info *dinfo,
   unsigned drawid_offset,
   const struct pipe_draw_indirect_info *indirect,
   const struct pipe_draw_start_count_bias *draws,
   unsigned num_draws)
{
...
   if (info.index_size) {
      ...
      virgl_hw_set_index_buffer(vctx, &ib);
   }

   if (!vctx->num_draws)
      virgl_reemit_draw_resources(vctx);
   vctx->num_draws++;

   virgl_hw_set_vertex_buffers(vctx);

   virgl_encoder_draw_vbo(vctx, &info, drawid_offset, indirect, &draws[0]);

   pipe_resource_reference(&ib.buffer, NULL);

}
```

`virgl_reemit_draw_resources()` 解決的是 command-buffer 邊界，不是再次驗證 GL state。 當新 cbuf 尚沒有 draw，driver 要將 framebuffer、shader、sampler、constant buffer 與其他 current binding 重新編碼，確保這份 command stream 自足。 後續 draw 只要 dirty state callback 已寫入差異，就不用每次全量 re-emit

index-buffer reference 顯示當地 ownership。 `ib.buffer` 可指向 application resource，也可指向 uploader 產生的暫時 resource。 `virgl_hw_set_index_buffer()` 與 draw encoder 使用它期間，local reference 防止 storage 消失。 command 寫完後 `pipe_resource_reference(&ib.buffer, NULL)` 只解除這個 local slot，cbuf resource list 仍保護 submit 所需的 `virgl_hw_res`

VirGL draw 也有「無作業」與「錯誤」的差別。 zero count、zero instance 或 trimming 後無完整 primitive 時，callback 可正常提前回傳。 driver 不支援的 primitive 若可由 `primconvert` 轉換，會走 conversion 路徑而不是立即失敗。 encoder 空間不足時可先提交舊 cbuf，將這次 draw 寫到新 cbuf

completion 在軟體路徑是 CPU raster work 已交給各 driver 的 pipeline，在 VirGL 路徑則只是 `virgl_encoder_draw_vbo()` 已將 command 與 renderer resource handle 寫進 guest cbuf。 這個 callback 不執行 execbuffer ioctl，所以圖上必須把 draw encoding 與 submit 分成兩個節點

#### Flush 到 ioctl UAPI

OpenGL `glFlush()` 的 frontend contract 是將先前 work 推向 driver，卻不強制呼叫端等到完成

`_mesa_Flush()` 取得 current context 並確認不在 Begin／End 之間，接著呼叫 `_mesa_flush()`。 固定版本的 [`Mesa: src/mesa/main/context.c:1608`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/context.c#L1608) `_mesa_flush()` 先執行 `FLUSH_VERTICES(ctx, 0, 0)`，再直接呼叫 `st_glFlush()`。 這條 API 呼叫路徑不經 `ctx->Driver.Flush`

State Tracker 的 `st_glFlush()` 接著呼叫 `st_flush()`，依序清理可回收的 zombie object、排空 bitmap cache，再呼叫 `st->pipe->flush`，最後執行 `st_manager_flush_frontbuffer()`。 前文 [`Mesa: src/mesa/state_tracker/st_cb_flush.c:50`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L50) 的已驗證片段表達 `st_flush()` 內部的前三個步驟

VirGL `pipe_context::flush` 指向 `virgl_flush_from_st()`。 `virgl_flush_eq()` 先檢查 cbuf 與 transfer queue 是否都為空，有 draw 時先 unmap uploader，再用 `virgl_transfer_queue_clear()` 排空 pending transfer。 這些 transfer 可成為 encoded `TRANSFER3D`，也可依 queue mode 先呼叫獨立 transfer ioctl，但兩條都在主 command submit 前完成

`virgl_drm_winsys_submit_cmd()` 將 cbuf dword count 轉成 byte size，把 cbuf storage 位址填入 `command`，把 winsys 收集的 kernel BO handles 填入 `bo_handles`。 若有 input sync-file，`fence_fd` 作為輸入並設定 flag。 呼叫端要求 Gallium fence 時，同一欄位會在 ioctl 成功後被改成 output fd

以下程式碼來自 [`Linux: include/uapi/drm/virtgpu_drm.h:77`](https://github.com/torvalds/linux/blob/0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53/include/uapi/drm/virtgpu_drm.h#L77) 的 `struct drm_virtgpu_execbuffer`，用來確認 command bytes、BO handle list 與 fence identity 如何組成一次 guest submission。 `flags` 與 in/out `fence_fd` 決定 sync-file direction，其餘 ring／syncobj 欄位則擴充 queue 與 synchronization contract：

```c
/* fence_fd is modified on success if VIRTGPU_EXECBUF_FENCE_FD_OUT flag is set. */
struct drm_virtgpu_execbuffer {
	__u32 flags;
	__u32 size;
	__u64 command; /* void* */
	__u64 bo_handles;
	__u32 num_bo_handles;
	__s32 fence_fd; /* in/out fence fd (see VIRTGPU_EXECBUF_FENCE_FD_IN/OUT) */
	__u32 ring_idx; /* command ring index (see VIRTGPU_EXECBUF_RING_IDX) */
	__u32 syncobj_stride; /* size of @drm_virtgpu_execbuffer_syncobj */
	__u32 num_in_syncobjs;
	__u32 num_out_syncobjs;
	__u64 in_syncobjs;
	__u64 out_syncobjs;
};
```

ownership 邊界位於 ioctl 呼叫。 command bytes 與 BO 陣列都由 userspace winsys 持有，呼叫期間以 UAPI pointer 借給 Linux 邊界。 `bo_handles` 裡是 DRM file namespace 中的 kernel BO handle，command dword 內則是 renderer resource handle。 前文已驗證的雙重清單在這裡同時出現，卻不可互相代用

Ioctl 入口是 [`Linux: include/uapi/drm/virtgpu_drm.h:237`](https://github.com/torvalds/linux/blob/0e35b9b6ec0ffcc5e23cbdec09f5c622ad532b53/include/uapi/drm/virtgpu_drm.h#L237) `DRM_IOCTL_VIRTGPU_EXECBUFFER`。 Mesa winsys 從 `drmIoctl()` 回傳值確認 request 是否成功交給 UAPI，kernel 接著擁有 command 驗證、scheduling 與 transport 責任

失敗時 winsys 記錄 errno，清掉已消費的 input fence fd、command dword count 與 resource list。 只有 ioctl 成功而且呼叫端要求 fence 時，才會以 output fd 建立 `pipe_fence_handle`。 這條失敗路徑並不自動把 OpenGL context 轉成 context-lost dispatch，兩者的邊界會在後面單獨處理

`glFlush()` 的 completion 只能說已編碼 work 已要求提交至 UAPI。 要等待 rendering completion，application 必須使用 `glFinish()` 或可查詢的 sync object，State Tracker 才會要求 fence 並透過 `pipe_screen::fence_finish` 等待。 單純非阻塞 flush 甚至可以不取得 fence

```callgraph
Mesa OpenGL draw 入口
=================================================
[Mesa: src/mesa/main/draw.c:1369] _mesa_DrawArrays(mode, start, count)
  │
  ├─ 若 `ctx->NewState != 0`
  │    └─ `_mesa_update_state(ctx)`
  │         // 先更新 core derived state，供後續驗證使用
  │
  ├─ 若不是 no-error context 且 `_mesa_validate_DrawArrays()` 失敗
  │    └─ `return`，這次 API 不產生 driver work
  └─ 成功
       └─ [Mesa: src/mesa/main/draw.c:1142] `_mesa_draw_arrays(ctx, mode, start, count, 1, 0)`
            ├─ 建立 `pipe_draw_info` 與 `pipe_draw_start_count_bias`
            └─ `ctx->Driver.DrawGallium(...)`
  ↓
Mesa State Tracker 與 Gallium
=================================================
[Mesa: src/mesa/state_tracker/st_draw.c:75] st_prepare_draw(ctx, state_mask)
  │
  ├─ 若 bitmap cache 非空，先 flush cache
  ├─ `st_validate_state(st, state_mask)` 發送 dirty atoms
  └─ `st_context_add_work(st)` 標記 context 已有 work
  ↓
[Mesa: src/mesa/state_tracker/st_draw.c:93] st_draw_gallium(ctx, info, ..., draws, num_draws)
  └─ `cso_draw_vbo(st->cso_context, info, ..., draws, num_draws)`
       └─ driver `pipe_context.draw_vbo`
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1011] virgl_draw_vbo(ctx, dinfo, ..., draws, num_draws)
  │
  ├─ 若 count／instance count 為零，提前回傳
  ├─ 若 primitive 需轉換，交給 `util_primconvert_draw_vbo()`
  └─ 否則寫入 `VIRGL_CCMD_DRAW_VBO`
       // 此時 draw 可能仍只在 guest command buffer

Mesa flush 與 Linux UAPI handoff
=================================================
後續 `glFlush()`／`glFinish()` 或 swap-triggered flush 階段
  ↓
[Mesa: src/mesa/state_tracker/st_cb_flush.c:51] st_flush(st, fence, flags)
  └─ `st->pipe->flush(st->pipe, fence, flags)`
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1121] virgl_flush_from_st(ctx, fence, flags)
  └─ [Mesa: src/gallium/drivers/virgl/virgl_context.c:1086] virgl_flush_eq(...)
       ├─ command 與 transfer queue 都空且不需 fence：`return`
       └─ drain transfer queue。 `virgl_submit_cmd(vws, cbuf, fence)`
  ↓
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:954] virgl_drm_winsys_submit_cmd(qws, cbuf, fence)
  │
  ├─ `eb.command = cbuf->buf`
  ├─ `eb.bo_handles = cbuf->res_hlist`
  └─ `DRM_IOCTL_VIRTGPU_EXECBUFFER`
       ├─ 失敗：回傳 error，呼叫端可將後續 state 視為不可靠
       └─ 成功：work 已交給 Linux virtio-gpu UAPI，fence 依要求回到 Gallium
```

### Swap 與 presentation 邊界

Application 完成 draw 後呼叫 `glXSwapBuffers()`，希望剛算好的內容出現在視窗裡。 不過 swap 函式回傳，只表示這一幀已越過某個交接點，尚不能直接推論使用者已經看到畫面，或原本的 buffer 已經可以安全重用

在 2D drisw 路徑中，Mesa 會把 CPU 算好的 pixels 交回 X drawable； 切到 VirGL／DRI3 時，Mesa 交付的是可呈現的 buffer 與同步條件。 接下來沿著 direct callback、indirect request 與兩種 Mesa-side X11 request 邊界，分別確認每一層完成了什麼

#### Direct GLX drawable callback

以下程式碼來自 [`Mesa: src/glx/glxcmds.c:668`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcmds.c#L668) 的 `__glXSwapBuffers()` direct 分支，用來追蹤 drawable lookup、current-context flush 條件與 presentation callback 的交接：

```c
void
__glXSwapBuffers(Display * dpy, GLXDrawable drawable)
{
   struct glx_context *gc = __glXGetCurrentContext();
   GLXContextTag tag;
   CARD8 opcode;
   xcb_connection_t *c;

#if defined(GLX_DIRECT_RENDERING)
   {
      __GLXDRIdrawable *pdraw = GetGLXDRIDrawable(dpy, drawable);

      if (pdraw != NULL) {
         Bool flush = gc != &dummyContext && drawable == gc->currentDrawable;

         if (pdraw->psc->driScreen.swapBuffers(pdraw, 0, 0, 0, flush) == -1)
             __glXSendError(dpy, GLXBadCurrentWindow, 0, X_GLXSwapBuffers, false);
         return;
      }
   }
#endif
...
}
```

`pdraw` 是 drawable table 中既有的 client-side object，此函式只在呼叫期間借用，不取得新 ownership。 `pdraw->psc` 指回 GLX screen，`driScreen.swapBuffers` 是 screen setup 時註冊的 direct backend callback。 不同 DRI loader 路徑可使用不同 callback 實作，但公開 GLX code 不需要辨識 driver 名稱

`flush` 只在兩個條件同時成立時為 true：`gc` 不是 `dummyContext`，而且傳入 XID 正是 `gc->currentDrawable`。 第一個條件已表示執行緒有真實 current context，不能再拆成另一項。 application 先前若已呼叫 `glFlush()`，這個布林值仍由 identity 關係計算，不會因 client code 推測前一次 flush 是否已足夠而改變

Callback 的三個 timing argument 在普通 `glXSwapBuffers()` 都是零，表示呼叫端沒有要求特定 target MSC、divisor 或 remainder。 Callback 依 drawable 目前 swap policy 處理這次交付，backend 再依可用 back buffer、ordering event 與 drawable state 決定 presentation 進度

direct 失敗在這個邊界有明確的同步表示：callback 回傳 `-1` 時，Mesa GLX 發出 `GLXBadCurrentWindow`。 回傳其他值只能說 callback 接受並處理這次 request，不能由此推導實體 display 已更新

這一步的 completion 是 direct callback 已取得 `pdraw`、timing arguments 與 `flush` flag，並以非 `-1` 回傳。 rendering completion 若必須在 swap 前被強制，要由 callback 依 loader/driver contract 處理，公開 GLX 分支本身不等 fence

#### Indirect GLX request

`GetGLXDRIDrawable()` 找不到 client-side direct drawable 時，`__glXSwapBuffers()` 才進入 protocol 分支。 因此這條路不可簡化成「只要 current context 是 indirect 就會走」。 真正的分流 key 是該 `Display *` 與 `GLXDrawable` 能否找到本地 DRI drawable

以下程式碼來自 [`Mesa: src/glx/glxcmds.c:690`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxcmds.c#L690) 的 `__glXSwapBuffers()` protocol 分支，用來追蹤 context tag、drawable XID 與 XCB request 的建立條件：

```c
void
__glXSwapBuffers(Display *dpy, GLXDrawable drawable)
{
...
   opcode = __glXSetupForCommand(dpy);
   if (!opcode) {
      return;
   }

   /*
    ** The calling thread may or may not have a current context.  If it
    ** does, send the context tag so the server can do a flush.
    */
   if ((gc != &dummyContext) && (dpy == gc->currentDpy) &&
       ((drawable == gc->currentDrawable)
        || (drawable == gc->currentReadable))) {
      tag = gc->currentContextTag;
   }
   else {
      tag = 0;
   }

   c = XGetXCBConnection(dpy);
   xcb_glx_swap_buffers(c, tag, drawable);
   xcb_flush(c);
}
```

Context tag 是先前 make-current protocol 取得、用來連結後續 GLX request 與 server-side current state 的 token，其 identity 與 Mesa `gl_context` pointer、GLX context XID 分屬不同 namespace。 Display 相同且 drawable 是 current draw 或 current read drawable 時，request 傳送這個 tag。 其他情況傳送零，使 server 不會把無關 context 的 pending render commands 納入這次 swap

`xcb_glx_swap_buffers()` 只接收 XCB connection、context tag 與 drawable XID。 ownership 邊界位於 XCB connection machinery。 request buffer 由它持有，Mesa 不為這次呼叫建立 local DRI drawable 或 `pipe_resource`。 `xcb_flush()` 將已排入的 request bytes 推向 X connection，這是 client transport completion，不是 swap completion

失敗在 indirect 分支不一定以函式回傳值同步呈現。 公開 `glXSwapBuffers()` 的回傳型態是 `void`，`xcb_glx_swap_buffers()` 在此使用 unchecked request，protocol error 可依 X11 error handling 路徑稍後抵達。 `__glXSetupForCommand()` 失敗則在 request 建立前就停止

completion 只是含 drawable XID 與可選 context tag 的 GLX request 已送出 client buffer。 後續 request dispatch、drawable storage 更新、presentation scheduling 與 display 都不屬於此 Mesa client source trace

#### Direct loader 到 X11 request 邊界

Direct callback 並沒有規定所有 loader 都要用同一種資料交付方式。 固定組態的 drisw 路徑會沿前面「GLX loader callback roundtrip」追過的 `softpipe_flush_frontbuffer()`、DRI 軟體 winsys 與 swrast loader callbacks，最後讓 Mesa GLX 呼叫 `XPutImage()` 或 `XShmPutImage()`。 VirGL／DRI3 路徑則會選出可呈現的 Pixmap 與同步條件，最後呼叫 XCB Present API

這兩條路徑都必須保留 application Window identity。 `drisw` 把它當成 `XPutImage()`／`XShmPutImage()` 的 target drawable； DRI3 helper 則把 Window XID 與 back-buffer Pixmap XID 一起交給 Present request。 Direct rendering 改變的是 rendering 結果如何產生與交付，沒有讓 Window identity 變成 Mesa object

以下程式碼來自 [`Mesa: src/glx/glxclient.h:92`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/glxclient.h#L92) 的 `struct __GLXDRIscreenRec`，用來比較 direct drawable 的 swap、時間線查詢、等待與 swap-interval callbacks：

```c
struct __GLXDRIscreenRec {

   void (*deinitScreen)(struct glx_screen *psc);

   __GLXDRIdrawable *(*createDrawable)(struct glx_screen *psc,
				       XID drawable,
				       GLXDrawable glxDrawable,
				       int type,
				       struct glx_config *config);

   int64_t (*swapBuffers)(__GLXDRIdrawable *pdraw, int64_t target_msc,
			  int64_t divisor, int64_t remainder, Bool flush);
   void (*copySubBuffer)(__GLXDRIdrawable *pdraw,
			 int x, int y, int width, int height, Bool flush);
   int (*getDrawableMSC)(struct glx_screen *psc, __GLXDRIdrawable *pdraw,
			 int64_t *ust, int64_t *msc, int64_t *sbc);
   int (*waitForMSC)(__GLXDRIdrawable *pdraw, int64_t target_msc,
		     int64_t divisor, int64_t remainder, int64_t *ust,
		     int64_t *msc, int64_t *sbc);
   int (*waitForSBC)(__GLXDRIdrawable *pdraw, int64_t target_sbc, int64_t *ust,
		     int64_t *msc, int64_t *sbc);
   int (*setSwapInterval)(__GLXDRIdrawable *pdraw, int interval);
   int (*getSwapInterval)(__GLXDRIdrawable *pdraw);
   void (*bindTexImage)(__GLXDRIdrawable *pdraw, int buffer, const int *attribs);

   int maxSwapInterval;
};
```

DRI3 screen setup 在 [`Mesa: src/glx/dri3_glx.c:538`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/dri3_glx.c#L538) 將 `dri3_swap_buffers` 寫入這個 slot。 Callback signature 交出 DRI drawable、target MSC、divisor、remainder 與 flush flag，`dri3_swap_buffers()` 再把這些值交給共用 DRI3 loader helper

以下兩段程式碼分別來自 Mesa GLX DRI3 callback 與 common loader helper，用來確認 direct callback 如何一路抵達 `xcb_present_pixmap()`。 第一篇在這個 client-side request API 呼叫停下，server 如何 dispatch、排程、flip／copy 與回報 completion 由本系列 Xorg／GLX／DRI3／Present 篇承接

```c
// [Mesa: src/glx/dri3_glx.c:361]
static int64_t
dri3_swap_buffers(__GLXDRIdrawable *pdraw,
                  int64_t target_msc, int64_t divisor,
                  int64_t remainder, Bool flush)
{
   struct dri3_drawable *priv = (struct dri3_drawable *)pdraw;
   unsigned flags = __DRI2_FLUSH_DRAWABLE;

   if (flush)
      flags |= __DRI2_FLUSH_CONTEXT;

   return loader_dri3_swap_buffers_msc(&priv->loader_drawable,
                                       target_msc, divisor, remainder,
                                       flags, NULL, 0, false);
}

// [Mesa: src/gallium/frontends/dri/loader_dri3_helper.c:1003]
int64_t
loader_dri3_swap_buffers_msc(struct loader_dri3_drawable *draw,
                             int64_t target_msc, int64_t divisor,
                             int64_t remainder, unsigned flush_flags,
                             const int *rects, int n_rects,
                             bool force_copy)
{
   struct loader_dri3_buffer *back;
   ...

   back->busy = 1;
   back->last_swap = draw->send_sbc;
   ...

   xcb_present_pixmap(draw->conn,
                      draw->drawable,
                      back->pixmap,
                      (uint32_t)draw->send_sbc,
                      0, region, 0, 0, None, None,
                      back->sync_fence, options,
                      target_msc, divisor, remainder,
                      0, NULL);
   ...
}
```

`draw->drawable` 是 application Window XID，`back->pixmap` 是這次要交付的 back-buffer Pixmap XID，`back->sync_fence` 則讓 server 知道 rendering 結果何時可讀。 `target_msc`、`divisor` 與 `remainder` 描述 presentation timing。 這些欄位共同構成 request input，但 `xcb_present_pixmap()` 回傳仍不等於 pixels 已出現在螢幕上

`flush` 的 owner 是呼叫端對 current context/drawable 關係的判斷，callback 只消費該值。 `pdraw` 則是可追回 GLX screen 與 DRI drawable 的 client object，不取代 XID。 target MSC 與 swap interval 用來描述 ordering request，SBC 用來辨識 swap sequence。 這些 counter 和 VirGL execbuffer fence fd 不是同一種 completion token

direct callback 回傳失敗可在 client 當下轉成 GLX error。 indirect request 的 error 則經 X11 protocol error 機制回到 application。 在兩條路徑上，drawable 若已銷毀、identity 無效或 storage 不可用，都不應以「swap 函式是 void」來推導必然成功

DRI3 presentation completion 由 event、SBC／MSC query 或 wait contract 辨識。 `glXSwapBuffers()` 回傳時，direct callback 已回傳，或 indirect request 已 flush 到 X connection。 X server 如何接手 request 與更新 display state，不在這一篇繼續展開

```callgraph
Application 與 Mesa GLX swap dispatch
=================================================
[Mesa: src/glx/glxcmds.c:668] __glXSwapBuffers(dpy, drawable)
  │
  │  `gc = __glXGetCurrentContext()`
  │  // current context 只用來決定 flush signal 與 indirect context tag
  │
  ├─ 若 [Mesa: src/glx/glxcmds.c:678] GetGLXDRIDrawable(dpy, drawable) 回傳 `pdraw`
  │    ├─ `flush = gc != &dummyContext && drawable == gc->currentDrawable`
  │    └─ 進入下方獨立的 direct-screen callback contract
  │
  └─ 若沒有 direct drawable
       └─ 進入下方獨立的 XCB／X server request 邊界

Mesa GLX direct-screen callback contract
=================================================
[Mesa: src/glx/glxclient.h:92] struct __GLXDRIscreenRec
  ├─ `swapBuffers(pdraw, target_msc, divisor, remainder, flush)` 接受 direct drawable state
  └─ `getDrawableMSC`／`waitForMSC`／`waitForSBC` 是另外的 query／wait operations
  ↓
[Mesa: src/glx/dri3_glx.c:538] `psp->swapBuffers = dri3_swap_buffers`
  └─ [Mesa: src/glx/dri3_glx.c:361] dri3_swap_buffers(...)
       └─ [Mesa: loader_dri3_helper.c:1003] loader_dri3_swap_buffers_msc(...)
            ├─ 選出 back-buffer Pixmap 與 sync fence
            └─ [Mesa: loader_dri3_helper.c:1192] xcb_present_pixmap(...)
                 // 最終結果：Mesa 已呼叫 XCB Present request API
  ↓
回到 [Mesa: src/glx/glxcmds.c:668] __glXSwapBuffers(...)
  ├─ callback 回傳 `-1`：送出 `GLXBadCurrentWindow`
  └─ 其他結果：direct 分支 `return`

Mesa GLX drisw direct-screen callback contract
=================================================
[Mesa: src/glx/drisw_glx.c:556] driswSwapBuffers(...)
  └─ softpipe／DRI 軟體 winsys／swrast loader callback roundtrip
       └─ [Mesa: src/glx/drisw_glx.c:199] swrastXPutImage(...)
            ├─ `XPutImage(...)`
            └─ `XShmPutImage(...)`
                 // canonical source trace 位於前面的 GLX loader callback roundtrip

Indirect XCB / X server request 邊界
=================================================
[Mesa: src/glx/glxcmds.c:690] `opcode = __glXSetupForCommand(dpy)`
  ├─ 若 `opcode == 0`，`return`
  ├─ 若 drawable 是 current draw／read，`tag = gc->currentContextTag`
  └─ 否則 `tag = 0`
  ↓
[Mesa: src/glx/glxcmds.c:708] XGetXCBConnection(dpy)
  ├─ `xcb_glx_swap_buffers(c, tag, drawable)`
  └─ `xcb_flush(c)`
       // 以 XID 與 context tag 交付 X server。 此節點不隸屬 direct-screen struct
```

### 失敗與 teardown trace

外層 GLX 生命週期在 swap 與所需的 completion 完成後進入正常 teardown：application 先解除 current context，再銷毀 GLX context 與 drawable，Mesa 依最後一個 reference 釋放 frontend objects、State Tracker、Gallium context 與 screen resources。 這條正常路徑讓同一條 context／render／swap 時間線收束在明確的 ownership 終點

Context 建立、shader compile／link、resource create／map、VirGL execbuffer 與 fence 各有自己的失敗分支。 以下分別從對應的原始程式碼位置追蹤錯誤如何改變 object state、哪一層負責清理，以及 application 還能查詢的 status、log、GL error 或 context-loss 結果。 各分支完成後再回到尚未建立、仍可重試或準備 teardown 的外層 state

#### Context 建立失敗 unwind

context 建立存在兩條同時建立的責任。 client direct renderer 路徑建立 Mesa GLX、DRI、State Tracker 與 Gallium objects。 GLX 另外向 X connection 發出 context bookkeeping request，讓新 XID 在 GLX resource namespace 中可用。 前一條成功不足以代表整體成功

以下程式碼來自 [`Mesa: src/glx/create_context.c:171`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/glx/create_context.c#L171) 的 `glXCreateContextAttribsARB()` checked-request block，用來追蹤 X server bookkeeping 失敗時的 client-side teardown，以及成功後 XIDs 的發布時點：

```c
GLXContext
glXCreateContextAttribsARB(Display *dpy, GLXFBConfig config,
                           GLXContext share_context, Bool direct,
                           const int *orig_attrib_list)
{
...
   cookie =
      xcb_glx_create_context_attribs_arb_checked(c,
                                                 xid,
                                                 cfg ? cfg->fbconfigID : 0,
                                                 screen,
                                                 share_xid,
                                                 gc->isDirect,
                                                 num_attribs,
                                                 (const uint32_t *)
                                                 attrib_list);
   err = xcb_request_check(c, cookie);
   if (err != NULL) {
      if (gc)
         gc->vtable->destroy(gc);
      gc = NULL;

      __glXSendErrorForXcb(dpy, err);
      free(err);
   } else {
      gc->xid = xid;
      gc->share_xid = share_xid;
   }

   free(attrib_list);
   return (GLXContext) gc;
}
```

`attrib_list` 是這次 wrapper 為過濾與正規化 attributes 建立的 local 陣列，成功與失敗都在函式結束前釋放。 `err` 是 XCB request check 回傳的 error object，送出 GLX error 後釋放。 `gc` 則只在 request 成功時轉成呼叫端可持有的 `GLXContext`

再往下看，`dri_create_context()` 的 [`Mesa: src/gallium/frontends/dri/dri_context.c:241`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L241) `fail` label 先檢查 `ctx && ctx->st`，存在才呼叫 `st_destroy_context()`，最後 free `dri_context`。 State Tracker 若只建立了 `pipe_context` 卻無法建立 `st_context`，則在 `st_api_create_context()` 當場呼叫 `pipe->destroy(pipe)`。 每層只釋放自己已經取得 ownership 的部分

version、profile、sharing compatibility 或 no-error mode 不相容時，失敗甚至可在 `dri_context` 或 `pipe_context` 建立前發生。 這類路徑只需釋放 attributes 與 GLX wrapper 配置，不應呼叫尚未存在的 driver destroy callback。 sharing context 是借用來找 share group，失敗不能銷毀舊 context

completion 需要同時滿足 client renderer graph 建立成功、checked GLX request 無 error、XID 寫入 `gc`，以及外層 vendor mapping 新增成功。 其中任一步失敗，application 都應收到空 `GLXContext` 或對應 GLX error，不得設成 current

#### Shader compile／link 失敗

shader compile 失敗是 object state，不一定是 OpenGL error。 沒有先呼叫 `glShaderSource()` 就 compile 時，前面的 source anchor 直接設 `COMPILE_FAILURE`。 preprocess、parse、語意檢查或 NIR 產生失敗時，compiler 也將訊息收斂到 `gl_shader::InfoLog` 與 `CompileStatus`。 application 可以查詢它們，修改 source 再次 compile

以下程式碼來自 [`Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:766`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_glsl_to_nir.cpp#L766) 的 `st_link_shader()`，用來追蹤新 program data 的建立，以及 attached-shader 失敗如何收斂到 program log 與 `LinkStatus`：

```c
void
st_link_shader(struct gl_context *ctx, struct gl_shader_program *prog)
{
   unsigned int i;
...
   _mesa_clear_shader_program_data(ctx, prog);

   prog->data = _mesa_create_shader_program_data();

   prog->data->LinkStatus = LINKING_SUCCESS;

   for (i = 0; i < prog->NumShaders; i++) {
      if (!prog->Shaders[i]->CompileStatus) {
	 linker_error(prog, "linking with uncompiled/unspecialized shader");
      }
...
   }
   ...
}
```

linker 還會檢查同 stage compilation units、`main` 函式、interface blocks、varying、uniform、resource limits 與跨 stage input/output。 這些失敗都要統一留在 program `LinkStatus` 與 `InfoLog`，而不是將 parser 或 NIR pass 的內部錯誤碼直接暴露給 application

固定版本 `link_program()` 在 `shProg->data->LinkStatus` 成功時，把新產生的 executable 安裝到正在使用該 program 的 stage。 失敗時 current rendering state 保留原有 executable，attached shader references 仍由 program object 持有，application 可解除 attach、替換 shader 或重新 link

ownership 的重點是不同 IR 各有一份 owner。 compile 中間的 parse state 與 HIR 在 compile 結束後回收，成功 per-shader NIR 屬於 `gl_shader`。 linker 為 `gl_program` clone 的 NIR 若在 link 中途失敗，要由新 program data 清理，不能釋放原始 shader 仍擁有的 NIR。 driver create callback 取得 ownership 後，則依 Gallium shader-state contract 回收

VirGL driver-state 建立另有三條固定版本必須分開看的失敗：

- `nir_to_tgsi_options()` 可能回傳 `NULL`，但 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:745`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L745) 沒有檢查，仍把空 `tokens` 傳給下一個 transform
- NIR input 的 `virgl_tgsi_transform()` 回傳 `NULL` 時，函式直接回傳，先前由 NIR conversion 配置的 `ntt_tokens` 沒有釋放
- `virgl_encode_shader_state()` 失敗時會釋放 `ntt_tokens`，卻沒有釋放已配置的 `new_tokens`

後兩條路徑明確回傳空 driver handle，但清理結果不同，分別遺留 `ntt_tokens` 與 `new_tokens`。 第一條連 conversion 失敗 guard 都沒有，因此固定原始程式碼無法證明它會乾淨地回傳空 handle。 這些是 fixed-checkout 清理缺口，不能寫成 Gallium contract 已完整回收暫時 IR。 只有 encode 成功的收尾同時釋放兩份 temporary tokens

失敗路徑的 completion 是 status 與 log 已穩定、暫時 linker data 已回收，而 current executable 沒有被失敗結果替換。 application 查詢錯誤後可繼續使用其他有效 program，失敗本身不需要銷毀整個 context

#### Out-of-memory、resource create 與 map 失敗

GL object name 建立、Gallium storage 建立與 CPU mapping 是三個可獨立失敗的階段。 `glGenBuffers()` 可先保留 name，直到首次 bind 才產生真實 object。 `glCreateBuffers()` 則立即配置 wrapper，失敗時記錄 `GL_OUT_OF_MEMORY`。 後續 `glBufferData()` 或 texture image definition 再要求 `pipe_screen::resource_create`，因此 wrapper 存在時 storage 仍可能未配置

以下程式碼來自 [`Mesa: src/mesa/main/bufferobj.c:3664`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/main/bufferobj.c#L3664) 的 `map_buffer_range()`，用來比較 driver map 失敗與成功 mapping 在 OpenGL object 上留下的 state：

```c
static void *
map_buffer_range(struct gl_context *ctx, struct gl_buffer_object *bufObj,
                 GLintptr offset, GLsizeiptr length, GLbitfield access,
                 const char *func)
{
   if (!bufObj->Size) {
      _mesa_error(ctx, GL_OUT_OF_MEMORY, "%s(buffer size = 0)", func);
      return NULL;
   }

   void *map = _mesa_bufferobj_map_range(ctx, offset, length, access, bufObj,
                                         MAP_USER);
   if (!map) {
      _mesa_error(ctx, GL_OUT_OF_MEMORY, "%s(map failed)", func);
   }
   else {
      /* The driver callback should have set all these fields.
       * This is important because other modules (like VBO) might call
       * the driver function directly.
       */
      assert(bufObj->Mappings[MAP_USER].Pointer == map);
      assert(bufObj->Mappings[MAP_USER].Length == length);
      assert(bufObj->Mappings[MAP_USER].Offset == offset);
      assert(bufObj->Mappings[MAP_USER].AccessFlags == access);
   }

   if (access & GL_MAP_WRITE_BIT) {
      bufObj->MinMaxCacheDirty = true;
   }
...
}
```

map 的 ownership 邊界位於 mapping 生命週期。 成功時，driver callback 不只回傳 CPU pointer，還要填寫 `Mappings[MAP_USER]` 的 pointer、length、offset 與 access flags，並將 `pipe_transfer` 存在 buffer object 對應 slot。 application 取得的是該生命週期內可用的 borrowed pointer，只能在對應 unmap 或 storage redefinition 前使用

Gallium resource create 失敗不可留下半完成 wrapper。 VirGL [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:728`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L728) 將 winsys `resource_create` 回傳的 `virgl_hw_res` 存進 wrapper，空值時 free wrapper 並回傳 `NULL`

classic ioctl 中途失敗則在 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:296`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L296) 釋放 `virgl_hw_res`，不公布 `res_handle` 或 `bo_handle`

VirGL map 可明確證明的 NULL 路徑較窄。 `virgl_resource_transfer_prepare()` 回傳 `VIRGL_TRANSFER_MAP_ERROR`、resource realloc 失敗或 winsys `resource_map()` 回傳空值時，`map_addr` 會是 NULL，已建立的 transfer 隨即銷毀，OpenGL buffer-map API 才能據此記錄 error

固定版本還有一個可觀察的記憶體配置缺口。 [`Mesa: src/gallium/drivers/virgl/virgl_resource.c:1001`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_resource.c#L1001) 的 `slab_zalloc()` 可回傳 NULL，map 呼叫端卻未檢查就把 transfer 傳給 prepare。 當配置在這裡失敗時，後續的 dereference 會讓一般 `NULL` 回傳 contract 無法成立

readback 路徑也忽略 `transfer_get()` 的整數結果，而 `resource_wait()` 只記錄錯誤並清掉 `maybe_busy`。 因此，這些失敗沒有完整向上傳遞。 source 能直接證明的是函式仍沿既有路徑處理 map pointer，application 端也未必收到對應的 GL error

completion 必須按層次說明。 resource create completion 是 `pipe_resource` 已持有 driver storage 並有 refcount。 對明確成功的 map 路徑，completion 是 non-null pointer 與 `pipe_transfer` metadata 已同時建立

Write mapping 在 unmap 或 explicit flush range 後才將 CPU writes 排入 driver-visible transfer。 成功回傳 pointer 只建立 CPU access。 readback／wait errno 需由各路徑自己處理，data submission 則由 transfer queue drain 與後續 flush 完成

#### Execbuffer／fence 失敗與 context loss 邊界

以下程式碼來自 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:985`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L985) 的 `virgl_drm_winsys_submit_cmd()` 收尾，用來確認 ioctl 失敗之後哪些 command、fd 與 resource-list state 仍會被清理

```c
static int
virgl_drm_winsys_submit_cmd(struct virgl_winsys *qws,
                            struct virgl_cmd_buf *_cbuf,
                            struct pipe_fence_handle **fence)
{
...
   ret = drmIoctl(qdws->fd, DRM_IOCTL_VIRTGPU_EXECBUFFER, &eb);
   if (ret == -1)
      _debug_printf("got error from kernel - expect bad rendering %d\n", errno);
   cbuf->base.cdw = 0;

   if (qws->supports_fences) {
      if (cbuf->in_fence_fd >= 0) {
         close(cbuf->in_fence_fd);
         cbuf->in_fence_fd = -1;
      }
      ...
   }
...
   virgl_drm_clear_res_list(cbuf);

   return ret;
}
```

完整的 output-fence 分支已在前文「VirGL guest driver 與 winsys／Flush、execbuffer 與 fence／DRM winsys execbuffer」單元展開。 output fence 只在 winsys 呼叫端提供 `fence` slot 且 ioctl 成功時建立

`virgl_drm_fence_create()` 對 execbuffer output fd 取得 ownership。 若 fence wrapper 配置失敗，該函式會關閉 fd 並回傳空值。 因此「ioctl 成功」與「winsys 呼叫端拿到可等待的 Gallium fence」仍是兩個條件

然而 [`Mesa: src/gallium/drivers/virgl/virgl_context.c:1070`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/drivers/virgl/virgl_context.c#L1070) 的 `virgl_submit_cmd()` 會丟棄這個 `ret`，`virgl_flush_from_st()` 也沒有錯誤回傳 channel。 ioctl 失敗時，這次 work 隨已清零的 cbuf 被丟棄，只留下 winsys 偵錯訊息。 winsys 的 output fence slot 保持空值，application 的 `glFlush()` 也看不到 errno 或同步 GL error

fence wait 回傳 false 也有多種可能，包含 timeout 尚未 signal 或底層 wait error。 `pipe_screen::fence_finish` 的布林值只說明在給定 timeout 內是否完成，不轉移 fence ownership。 呼叫端等待後仍要透過 `fence_reference` 解除 local slot

context loss 則需要 driver reset-status contract，不能只看 execbuffer errno。 State Tracker 的 [`Mesa: src/mesa/state_tracker/st_cb_flush.c:134`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/mesa/state_tracker/st_cb_flush.c#L134) `st_device_reset_callback()` 會保存 `pipe_reset_status`，然後呼叫 `_mesa_set_context_lost_dispatch()`

`st_get_graphics_reset_status()` 則透過 `pipe_context::get_device_reset_status` 查詢 driver，並轉成 OpenGL reset status。 固定版本的 VirGL context callback table 沒有設定 `get_device_reset_status`

上面的 execbuffer 函式在 winsys 失敗後清除這次 command 與 resource list，而 reset status 與 context-lost dispatch 由另一組 driver callbacks 更新。 `glFlush()` 是 `void` API，因此 application 無法以這次回傳值同步取得 errno，後續 GL 呼叫會依 reset-status 路徑實際安裝的 state 繼續

只有 driver 另行透過 Gallium reset contract 回報非 `PIPE_NO_RESET`，Mesa 才會進入明確的 context-loss 邊界。 固定 VirGL callback table 沒有提供這條路徑

失敗路徑的 completion 在這裡是清理已完成：input fd 不再屬於 cbuf，resource list reference 已解除，winsys fence slot 只有在 `ret == 0` 且 wrapper 非空值時才取得 completion object

VirGL driver 丟棄 `ret` 後，上層 fence output 保持空值。 application 看不到同步錯誤，也不會自動進入 context loss。 context-loss completion 另以 reset status 與 context-lost dispatch 為準，不和這個 errno 合併

#### Unbind、destroy context、object reference 與 screen teardown

當 application 關閉視窗，或不再需要某個 OpenGL context 時，它可能仍是呼叫端執行緒的 current context，draw／read drawable 與各層 object 也可能還持有 references。 因此，teardown 不能只從最外層 context pointer 開始釋放

這條時間線先以空 context 解除目前的 make-current binding，再銷毀 GLX context。 依序往下追可以看見 TLS dispatch、winsys framebuffer、DRI drawable、State Tracker、Gallium context 與 VirGL command resources 分別在哪個時點解除 ownership

DRI [`Mesa: src/gallium/frontends/dri/dri_context.c:271`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_context.c#L271) `dri_unbind_context()` 等 glthread 完成，呼叫 `st_api_make_current(NULL, NULL, NULL)`，再對 draw/read `dri_drawable` 執行 `dri_put_drawable()`。 draw 與 read 是同一個 object 時只解一次 reference，不同才分別解除

`glXDestroyContext()` 之後進入 DRI destroy。 `dri_destroy_context()` 先等 glthread，銷毀 HUD，接著呼叫 `st_context_flush()` 排空可能尚存的 command。 原始程式碼註解明確說這裡沒有特別理由等待 command completion，flush 只是避免其他清理程式碼面對半銷毀 context。 之後 `st_destroy_context()` 釋放 Mesa core、State Tracker 與 pipe resources

State Tracker destroy 暫時把要銷毀的 context make-current，確保 texture、framebuffer 與 program reference 清理會使用正確 `pipe_context`。 它釋放 winsys framebuffer list、sampler views、shader variants、VBO state、zombie objects 與 core context data，最後由 `st_destroy_context_priv(st, true)` 呼叫 `pipe->destroy(pipe)`。 若 destroy 前另一個 context 為 current，清理結束後會還原它與原 draw/read buffers

VirGL `pipe_context::destroy` 再刪除 framebuffer surface objects、銷毀 sub-context，呼叫 `virgl_flush_eq()` 送出最後 encoded deletes，解除 shader view、UBO、SSBO、image 與 atomic-buffer references，然後銷毀 cbuf、uploader、staging、primitive converter、transfer queue 與 context 本體。 這條 context destroy 路徑到此結束，不會呼叫 `dri_destroy_screen()` 或 `pipe_screen::destroy`

最後一次 flush 的失敗不會產生 completion fence。 即使 submit 成功，這個 flush 仍不等 fence。 呼叫端若需要確認工作退休，應在 teardown 前明確同步

GL object 生命週期可比 context 更長。 shared texture、buffer、shader 與 program 只會在 name 已刪除而且所有 context、view、attachment 與 command reference 都解除後進入最終釋放。 銷毀單一 context 只釋放它持有的 references，不可無條件清空整個 share group namespace

screen teardown 是 loader 稍後觸發的另一個生命週期 root。 [`Mesa: src/gallium/frontends/dri/dri_util.c:194`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_util.c#L194) 的 `driDestroyScreen()` 註解指出它在 `XCloseDisplay` 之後呼叫，再直接進入 `dri_destroy_screen()`

固定版本的 `struct dri_screen` 沒有替 context 或 drawable 維護 refcount。 Loader 必須先結束相依 object 的使用，不能期待 `dri_screen` 自己延後銷毀

以下程式碼來自 [`Mesa: src/gallium/frontends/dri/dri_screen.c:574`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/frontends/dri/dri_screen.c#L574) 的 `dri_release_screen()` 與 `dri_destroy_screen()`，用來追蹤獨立 screen teardown root 釋放 State Tracker、driver screen、loader device 與 DRI screen 本體的順序：

```c
void
dri_release_screen(struct dri_screen * screen)
{
   st_screen_destroy(&screen->base);

   if (screen->base.screen) {
      screen->base.screen->destroy(screen->base.screen);
      screen->base.screen = NULL;
   }

   if (screen->dev) {
      pipe_loader_release(&screen->dev, 1);
      screen->dev = NULL;
   }

   mtx_destroy(&screen->opencl_func_mutex);
}

void
dri_destroy_screen(struct dri_screen *screen)
{
   dri_release_screen(screen);

   free(screen->options.force_explicit_uniform_loc_zero);
   free(screen->options.force_gl_vendor);
   free(screen->options.force_gl_renderer);
   free(screen->options.mesa_extension_override);

   driDestroyOptionCache(&screen->optionCache);
   driDestroyOptionInfo(&screen->optionInfo);

   /* The caller in dri_util preserves the fd ownership */
   free(screen);
}
```

`pipe_screen::destroy` 若指向 VirGL DRM wrapper，才會進入另一層 fd-keyed cache 生命週期。 [`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1366`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1366) 會讓指向同一個 DRM file description 的 fd 共用 `pipe_screen`，每次 cache hit 增加 `virgl_screen::refcnt`。 這個計數只追蹤 fd-keyed screen cache 的取得次數，不是 DRI context 或 drawable 的 refcount

[`Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1309`](https://gitlab.freedesktop.org/mesa/mesa/-/blob/eaa4b57774d1f8825dcdfc280ceb8adbecfd19d3/src/gallium/winsys/virgl/drm/virgl_drm_winsys.c#L1309) 的 `virgl_drm_screen_destroy()` 將這個 cache count 減一。 非零時只結束本次 cache reference。 降為零才移除 entry、關閉 duplicated DRM fd，還原原本的 driver destroy callback，並進入 `virgl_destroy_screen()` 釋放 transfer pool、winsys、disk cache 與 `virgl_screen`

context teardown completion 是 GLX 與 GLAPI TLS 都不再指向舊 context，draw/read drawable references 已解除，State Tracker 與 driver context 已銷毀，share-group objects 依最後 reference 正常退休

稍後的 screen teardown 另從 `driDestroyScreen()` 開始，釋放 `pipe_screen` 與 loader device。 VirGL 只有在同一 DRM file description 的 cache count 歸零時才連同 winsys 與 duplicated fd 一起銷毀。 兩個 completion 都不自動證明 display 已呈現最後一幀

```callgraph
Application 與 Mesa GLX unbind
=================================================
[Mesa: src/glx/glxcurrent.c:106] MakeContextCurrent(dpy, 0, 0, NULL, opcode)
  │
  ├─ 若有 old current context
  │    ├─ `oldGC->vtable->unbind(oldGC)`
  │    ├─ `oldGC->currentDpy = NULL`
  │    └─ 若 context 先前已 destroy 且 `xid == None`，此時釋放 handle
  └─ `__glXSetCurrentContextNull()`
       // GLX TLS 不再持有 context，draw／read drawable 可在各自 refcount 歸零後回收
  ↓
[Mesa: src/glx/dri_common.c:777] dri_unbind_context(glx_context)
  └─ `driUnbindContext(context->driContext)`
       ↓
[Mesa: src/gallium/frontends/dri/dri_util.c:704] driUnbindContext(dri_context)
  ├─ `ctx == NULL`：return `GL_FALSE`
  └─ [Mesa: src/gallium/frontends/dri/dri_context.c:273] dri_unbind_context(ctx)
       │
       ├─ context 仍是 State Tracker current：`st_api_make_current(NULL, NULL, NULL)`
       └─ drop `ctx->draw`／`ctx->read` references，兩欄設為 `NULL`

Mesa GLX 與 DRI context 銷毀
=================================================
後續 `glXDestroyContext()` 階段
  ↓
[Mesa: src/glx/dri_common.c:783] dri_destroy_context(glx_context)
  ├─ `driReleaseDrawables(context)`
  └─ `driDestroyContext(context->driContext)`
       ↓
[Mesa: src/gallium/frontends/dri/dri_util.c:645] driDestroyContext(dri_context)
  └─ `ctx != NULL` 時呼叫 driver frontend destructor
       ↓
[Mesa: src/gallium/frontends/dri/dri_context.c:250] dri_destroy_context(ctx)
  │
  ├─ `_mesa_glthread_finish(ctx->st->ctx)`
  └─ [Mesa: src/mesa/state_tracker/st_context.c:866] st_destroy_context(ctx->st)
       ├─ 釋放 framebuffer／view／program 與 CSO references
       └─ `st->pipe->destroy(st->pipe)`
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1598] virgl_context_destroy(pipe)
  │
  ├─ 若 command buffer 還有 object delete 或 pending work
  │    └─ flush guest command buffer
  └─ 釋放 transfer queue、uploader、command buffer 與 context-owned objects
       // 最終結果：context graph 拆除。 此路徑不呼叫 screen destroy

獨立的 DRI screen 生命週期 root
=================================================
[Mesa: src/gallium/frontends/dri/dri_util.c:194] driDestroyScreen(psp)
  ├─ `psp == NULL`：return
  └─ `psp != NULL`：`dri_destroy_screen(psp)`
       // loader 另行啟動。 `dri_screen` 沒有 context／drawable refcount
  ↓
[Mesa: src/gallium/frontends/dri/dri_screen.c:593] dri_destroy_screen(screen)
  └─ [Mesa: src/gallium/frontends/dri/dri_screen.c:575] dri_release_screen(screen)
       ├─ `st_screen_destroy(&screen->base)`
       ├─ 若 `screen->base.screen != NULL`
       │    └─ `screen->base.screen->destroy(screen->base.screen)`
       ├─ 釋放 pipe-loader device
       └─ 釋放 options、cache 與 `dri_screen`

VirGL DRM fd-keyed pipe-screen cache
=================================================
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:1309] virgl_drm_screen_destroy(pipe_screen)
  ├─ `--screen->refcnt != 0`
  │    └─ `return`
  │         // 只表示同一 DRM file description 的其他 cache acquisition 尚在
  └─ `--screen->refcnt == 0`
       ├─ 從 fd table 移除 entry，`close(duplicated_fd)`
       ├─ 還原原本的 driver `pipe_screen::destroy`
       ↓
     [Mesa: src/gallium/drivers/virgl/virgl_screen.c:818] virgl_destroy_screen(pipe_screen)
       └─ 釋放 transfer pool、winsys、disk cache 與 `virgl_screen`
            // 最終結果：VirGL fd-keyed cached pipe screen 銷毀
```

完整 workload 因而有六個不可互換的 completion point。 context 建立以 object graph 與 GLX XID 都建立為準。 make-current 以 GLX 與 GLAPI TLS 都安裝成功為準。 shader/resource 初始化以 program executable、storage 與 driver state 可用為準。 draw 在 VirGL 路徑只代表 command 已編碼，flush 只代表已要求透過 UAPI submit，fence signal 才代表對應 work 已完成

swap 另以 direct callback 或 indirect request 為 presentation 邊界，實際 display completion 需要額外的 completion query、wait operation 或 event contract。 context teardown 以 current references 已清除且 context graph 已拆除為準，shared objects 依 reference 退休

screen teardown 是 loader 稍後啟動的獨立 root。 VirGL winsys 只受同一 DRM file description 的 fd-keyed screen cache count 控制

```callgraph
Application context 與 state setup
=================================================
[Mesa: src/glx/create_context.c:46] glXCreateContextAttribsARB(...)
  ├─ 失敗：回傳 `NULL`，workload 不進入 rendering
  └─ 成功：建立 GLX／DRI／State Tracker／Gallium context graph
  ↓
[Mesa: src/glx/glxcurrent.c:106] MakeContextCurrent(...)
  ├─ unbind 前驗證失敗：舊 current context 保持有效
  ├─ unbind 後 BadAccess／backend bind 失敗：GLAPI TLS 保持 null context
  └─ 成功：`current_context = gc`，draw／read framebuffer 可供驗證
  ↓
[Mesa: src/mesa/main/shaderapi.c:1193] set_shader_source(shader, source, source_hash)
  └─ 安裝 Mesa 內部副本。 application 仍擁有傳入 `glShaderSource()` 的原字串
  ↓
[Mesa: src/mesa/main/shaderapi.c:1237] _mesa_compile_shader(ctx, shader)
  ├─ source 缺失或 compiler 失敗：`CompileStatus = COMPILE_FAILURE`
  └─ 成功：per-shader NIR 與 info log 保存於 `gl_shader`
  ↓
[Mesa: src/mesa/state_tracker/st_glsl_to_nir.cpp:766] st_link_shader(ctx, program)
  ├─ link 失敗：保留 program info log，不安裝新 executable
  └─ 成功：linked stages、vertex／sampler／framebuffer bindings 可進入 draw 驗證
  ↓
Mesa draw 與 submission
=================================================
[Mesa: src/mesa/main/draw.c:1369] _mesa_DrawArrays(mode, start, count)
  ├─ 驗證失敗或 count 為零：`return`，沒有 driver work
  └─ [Mesa: src/mesa/main/draw.c:1142] `_mesa_draw_arrays()` 建立 `pipe_draw_info` 與 draw range
       └─ `ctx->Driver.DrawGallium(...)` 交給 State Tracker
  ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1011] virgl_draw_vbo(...)
  └─ draw state 與 resource handle 寫入 `virgl_cmd_buf`
       // API 回傳時 command 可能仍在 guest userspace
  ↓
[Mesa: src/mesa/state_tracker/st_cb_flush.c:51] st_flush(st, fence, flags)
  └─ `st->pipe->flush(st->pipe, fence, flags)`
       ↓
[Mesa: src/gallium/drivers/virgl/virgl_context.c:1121] virgl_flush_from_st(ctx, fence, flags)
  └─ drain transfer queue。 `virgl_submit_cmd(vws, cbuf, fence)`
       ↓
[Mesa: src/gallium/winsys/virgl/drm/virgl_drm_winsys.c:954] virgl_drm_winsys_submit_cmd(...)
       ├─ ioctl 失敗：回傳 error，submission completion 不成立
       └─ ioctl 成功：command bytes、BO handles 與可選 fence 交給 Linux UAPI
  ↓
Mesa GLX presentation handoff
=================================================
[Mesa: src/glx/glxcmds.c:668] __glXSwapBuffers(dpy, drawable)
  ├─ 若 direct drawable 存在
  │    └─ 交給 `driScreen.swapBuffers(pdraw, ..., flush)`
  └─ 否則
       └─ `xcb_glx_swap_buffers(c, tag, drawable); xcb_flush(c)`
            // rendering submission 與 presentation request 在此以不同 completion contract 交界
  ↓
Mesa client context teardown
=================================================
[Mesa: src/gallium/frontends/dri/dri_context.c:250] dri_destroy_context(ctx)
  └─ [Mesa: src/mesa/state_tracker/st_context.c:866] st_destroy_context(ctx->st)
       └─ `st->pipe->destroy(st->pipe)` 釋放 context-owned state
            // 最終結果：context destroy 不呼叫 screen destroy

後續獨立的 loader screen teardown
=================================================
[Mesa: src/gallium/frontends/dri/dri_util.c:194] driDestroyScreen(screen)
  └─ `dri_destroy_screen(screen)`
  ↓
[Mesa: src/gallium/frontends/dri/dri_screen.c:593] dri_destroy_screen(screen)
  ├─ 釋放 State Tracker screen data 與 loader device
  └─ `pipe_screen->destroy(pipe_screen)`
       ├─ 非 VirGL cache wrapper：直接執行 driver screen destroy
       └─ VirGL cache wrapper：同一 DRM file description 的 `refcnt` 歸零才銷毀 winsys 與 fd
            // 這是獨立生命週期 root，不由 `dri_destroy_context()` 觸發
```
