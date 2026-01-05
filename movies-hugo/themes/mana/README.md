# Hugo Mana Theme

Futuristic hugo theme featuring clean aesthetics, and modern functionality and responsive design.

## Features

- **Fully responsive** design with mobile-first approach
- **Full-text search** with JSON index and keyboard navigation
- **Syntax highlighting** with theme-aware Chroma (Catppuccin themes)
- **Table of Contents** with active section highlighting
- **Dark/Light theme** with system preference detection and manual toggle
- **Post filtering** by tags, year, and month
- **Archive pages** with chronological organization
- **SEO optimized** with Open Graph, Twitter Cards, and structured data
- **Performance optimized** with asset minification and caching
- **Integrations**: Buy Me a Coffee, Umami Analytics, social links

## Installation

This theme is installed as a Git submodule. To add it to your Hugo site:

```bash
git submodule add https://github.com/Livour/hugo-mana-theme.git themes/mana
```

Then set `theme = "mana"` in your `hugo.toml` configuration file.

## Requirements

- Hugo Extended version 0.100.0 or higher (required for PostCSS support)

## Configuration

Add the following configuration to your `hugo.toml` file. You can also reference the `example.toml` file in the theme root for a complete example configuration.

### Basic Configuration

```toml
[params]
  description = "Your site description"
  favicon = "/favicon/favicon.ico"
  footerText = "Built with Hugo and Mana theme"  # Optional
  
  # Hero section title (optional - defaults to site.Title)
  heroTitleLine1 = "Your Site Name"  # First line of hero title
  heroTitleLine2 = "Your Tagline"    # Second line of hero title (optional)
```

### Avatar

Configure your avatar image (displayed on home page and about page):

```toml
[params.avatar]
  url = "https://example.com/avatar.jpg"
```

### Social Links

Add your social media links:

```toml
[params.social]
  github = "https://github.com/yourusername"
  linkedin = "https://www.linkedin.com/in/yourprofile"
  email = "your.email@example.com"
```

### Buy Me a Coffee Widget

Enable the Buy Me a Coffee floating widget:

```toml
[params.buyMeACoffee]
  enabled = true
  id = "yourwidgetid"
  description = "Support me on Buy me a coffee!"
  message = ""  # Optional message
  color = "#BD5FFF"  # Widget color
  position = "Right"  # "Left" or "Right"
  x_margin = "18"  # Horizontal margin in pixels
  y_margin = "18"  # Vertical margin in pixels
```

### Menu Configuration

Configure your site navigation menu:

```toml
[[menus.main]]
  name = 'Home'
  pageRef = '/'
  weight = 10

[[menus.main]]
  name = 'Posts'
  pageRef = '/posts'
  weight = 20

[[menus.main]]
  name = 'Tags'
  pageRef = '/tags'
  weight = 30

[[menus.main]]
  name = 'About'
  url = '/about/'
  weight = 40
```

### Table of Contents

Enable table of contents for posts:

```toml
[markup]
  [markup.tableOfContents]
    startLevel = 1
    endLevel = 6
    ordered = false
```

### Code Syntax Highlighting

The theme supports theme-aware syntax highlighting using Chroma. By default, it uses Catppuccin themes:
- **Dark mode**: `catppuccin-macchiato`
- **Light mode**: `catppuccin-frappe`

Configure the themes in your `hugo.toml`:

```toml
[markup]
  [markup.highlight]
    codeFences = true
    guessSyntax = true
    noClasses = false
    style = "catppuccin-macchiato"  # Default style

[params]
  [params.codeHighlight]
    darkTheme = "catppuccin-macchiato"   # Theme for dark mode
    lightTheme = "catppuccin-frappe"     # Theme for light mode
```

#### Generating Syntax Highlighting CSS

To generate the CSS files for syntax highlighting, run these commands in your project root:

```bash
# Generate dark theme CSS
hugo gen chromastyles --style=catppuccin-macchiato > themes/mana/assets/css/syntax-dark.css

# Generate light theme CSS
hugo gen chromastyles --style=catppuccin-frappe > themes/mana/assets/css/syntax-light.css
```

**Note**: These CSS files are already included in the theme. You only need to regenerate them if you want to use different Chroma styles. You can use any valid Chroma style name (e.g., `github`, `monokai`, `dracula`, etc.).

### Search Index

Enable JSON output for search functionality:

```toml
[outputs]
  home = ["HTML", "JSON"]
```

### 404 Page Configuration

Customize the 404 error page message:

```toml
[params]
  # Custom message for the 404 error page (supports HTML)
  # If not set, defaults to: "Sorry, the page you are looking for could not be found."
  custom404Message = "Sorry, the page you are looking for could not be found. I guess I don't have a guide for <em>everything</em>"
```

The 404 page uses the same hero section styling as your home page, providing a consistent user experience.

### Umami Analytics

The theme supports Umami Analytics for privacy-friendly page tracking:

```toml
[params]
  [params.umami]
    # Set your Umami website ID for page tracking
    websiteId = "your-umami-website-id"
```

To use Umami:
1. Sign up for an account at [Umami Cloud](https://umami.is/) or self-host Umami
2. Create a website in your Umami dashboard
3. Copy your website ID and add it to your configuration

The Umami script will be automatically included in your site's `<head>` section.

## Post Frontmatter

The theme supports standard Hugo frontmatter. For post images, add an `image` parameter:

```markdown
---
title: "Your Post Title"
date: 2024-01-01
tags: ["tag1", "tag2"]
image: "/images/your-image.png"
---
```

## Pages

The theme includes layouts for:
- **Home page** - Displays mini about section and recent posts
- **Posts listing** - Shows all posts with filtering
- **Single post** - Individual post view with metadata and table of contents
- **Tags page** - Tag cloud view
- **Individual tag page** - Posts grouped by year for each tag
- **About page** - About page with avatar and social links
- **404 page** - Custom error page with hero section styling

## License

MIT

