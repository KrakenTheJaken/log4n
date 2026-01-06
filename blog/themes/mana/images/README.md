# Theme Screenshots

This directory should contain two images for the Hugo themes site:

1. **screenshot.{png,jpg}** - Minimum size: 1500×1000 px (3:2 aspect ratio)
   - Shows the theme's layout without browser/device mockups
   - Should showcase the theme's design and features

2. **tn.{png,jpg}** - Minimum size: 900×600 px (3:2 aspect ratio)
   - Thumbnail version of the screenshot
   - Used for theme previews on themes.gohugo.io

## Image Requirements

- **Aspect Ratio**: Both images must have a 3:2 aspect ratio
- **Format**: PNG or JPG
- **Content**: Show the theme layout without browser/device mockups
- **Location**: Place files directly in this `images/` directory

## Creating Screenshots

1. Build your Hugo site: `hugo server`
2. Take a screenshot of your theme (homepage or a post page)
3. Resize to meet the minimum dimensions while maintaining 3:2 aspect ratio
4. Save as `screenshot.png` and create a thumbnail version as `tn.png`

## Absolute Paths in README

When referencing these images in the README.md, use absolute paths:
- `https://raw.githubusercontent.com/Livour/hugo-mana-theme/main/images/screenshot.png`
- `https://raw.githubusercontent.com/Livour/hugo-mana-theme/main/images/tn.png`

