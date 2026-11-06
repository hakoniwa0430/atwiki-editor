Add-Type -AssemblyName System.Drawing
$canvas = [System.Drawing.Bitmap]::new(1024,1024)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.ScaleTransform(4,4)
$g.Clear([System.Drawing.Color]::Transparent)
$orange = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#ed8500'))
$paper = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#fff8ed'))
$fold = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#ffd28a'))
$pen = [System.Drawing.Pen]::new($orange,8)
$pen.LineJoin = 'Round'
$points = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(32,16),[System.Drawing.PointF]::new(167,16),[System.Drawing.PointF]::new(224,73),[System.Drawing.PointF]::new(224,240),[System.Drawing.PointF]::new(32,240))
$g.FillPolygon($paper,$points)
$g.DrawPolygon($pen,$points)
$triangle = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(167,16),[System.Drawing.PointF]::new(167,73),[System.Drawing.PointF]::new(224,73))
$g.FillPolygon($fold,$triangle)
$g.DrawLines($pen,$triangle)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = 'Center'
$format.LineAlignment = 'Center'
$font = [System.Drawing.Font]::new('Segoe UI',106,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$small = [System.Drawing.Font]::new('Segoe UI',38,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('@',$font,$orange,[System.Drawing.RectangleF]::new(38,64,180,116),$format)
$g.DrawString('wiki',$small,$orange,[System.Drawing.RectangleF]::new(38,175,180,48),$format)
$result = [System.Drawing.Bitmap]::new(256,256)
$out = [System.Drawing.Graphics]::FromImage($result)
$out.InterpolationMode = 'HighQualityBicubic'
$out.DrawImage($canvas,0,0,256,256)
$result.Save((Join-Path $PWD 'media/icons/extension.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose(); $result.Dispose(); $g.Dispose(); $canvas.Dispose(); $font.Dispose(); $small.Dispose(); $format.Dispose(); $pen.Dispose(); $orange.Dispose(); $paper.Dispose(); $fold.Dispose()
