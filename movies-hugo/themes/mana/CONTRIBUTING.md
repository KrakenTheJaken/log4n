# Contributing to Hugo Mana Theme

Thank you for your interest in contributing to the Hugo Mana Theme! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Code Style Guidelines](#code-style-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow:

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

## How Can I Contribute?

### Reporting Bugs

If you find a bug, please create an issue with the following information:

- **Clear title** describing the bug
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Screenshots** if applicable
- **Environment details**:
  - Hugo version (run `hugo version`)
  - Browser and version
  - Operating system
- **Minimal reproduction** if possible

### Suggesting Features

Feature suggestions are welcome! Please create an issue with:

- **Clear description** of the feature
- **Use case** - why would this be useful?
- **Possible implementation** ideas (optional)
- **Examples** of similar features in other themes (optional)

### Pull Requests

Pull requests are the best way to contribute! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Test thoroughly** (see [Development Setup](#development-setup))
5. **Commit your changes** (see [Commit Guidelines](#commit-guidelines))
6. **Push to your branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

## Development Setup

### Prerequisites

- **Hugo Extended** version 0.100.0 or higher
- **Git** for version control
- A code editor of your choice

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Livour/hugo-mana-theme.git
   cd hugo-mana-theme
   ```

2. **Create a test site:**
   ```bash
   hugo new site test-site
   cd test-site
   ```

3. **Link the theme:**
   ```bash
   # On Linux/Mac
   ln -s ../hugo-mana-theme themes/mana
   
   # On Windows (PowerShell)
   New-Item -ItemType SymbolicLink -Path "themes\mana" -Target "..\hugo-mana-theme"
   ```

4. **Configure the theme:**
   ```bash
   cp themes/mana/example.toml hugo.toml
   ```

5. **Start the development server:**
   ```bash
   hugo server
   ```

6. **Create test content:**
   ```bash
   hugo new posts/test-post.md
   ```

### Testing Your Changes

Before submitting a PR, please test:

- ✅ **Build succeeds** (`hugo` command completes without errors)
- ✅ **Development server works** (`hugo server` runs without errors)
- ✅ **Responsive design** - test on mobile, tablet, and desktop sizes
- ✅ **Dark/Light theme toggle** works correctly
- ✅ **All pages render** (home, posts, tags, archive, about, 404)
- ✅ **No console errors** in browser developer tools
- ✅ **Accessibility** - check with browser accessibility tools

## Code Style Guidelines

### HTML Templates

- Use **2 spaces** for indentation
- Use **semantic HTML5** elements
- Include **ARIA labels** for accessibility
- Keep templates **DRY** (Don't Repeat Yourself) - use partials when appropriate
- Comment complex logic in templates

### CSS

- Use **CSS custom properties** (variables) from `theme.css`
- Follow **BEM-like naming** conventions where appropriate
- Keep styles **scoped** to components
- Use **mobile-first** responsive design
- Comment complex CSS rules

### JavaScript

- Use **modern ES6+** syntax
- Keep functions **small and focused**
- Add **JSDoc comments** for complex functions
- Use **const/let** instead of var
- Handle **errors gracefully**

### File Organization

```
themes/mana/
├── layouts/          # Hugo templates
│   ├── _default/     # Default templates
│   ├── partials/     # Reusable partials
│   └── ...
├── assets/           # Source files (CSS, JS)
│   ├── css/          # Stylesheets
│   └── js/           # JavaScript files
├── static/           # Static assets (if any)
└── ...
```

## Commit Guidelines

### Commit Message Format

Use clear, descriptive commit messages:

```
type(scope): brief description

Optional longer description explaining what and why
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(search): add keyboard navigation to search modal

fix(theme): correct dark mode toggle on page load

docs(readme): update installation instructions

style(css): improve mobile responsive spacing
```

## Pull Request Process

### Before Submitting

1. **Update documentation** if you've changed functionality
2. **Add comments** for complex code
3. **Test across browsers** (Chrome, Firefox, Safari, Edge)
4. **Check responsive design** on multiple screen sizes
5. **Ensure no linting errors**

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Tested responsive design
- [ ] Tested dark/light theme toggle
- [ ] No console errors

## Screenshots (if applicable)
Add screenshots here
```

### Review Process

1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, your PR will be merged
4. Thank you for contributing! 🎉

## Specific Contribution Areas

### Adding New Features

- **Keep it optional** - use config parameters when possible
- **Maintain backward compatibility** - don't break existing sites
- **Update documentation** - README.md and example.toml
- **Add examples** if applicable

### Fixing Bugs

- **Reproduce the bug** first
- **Fix the root cause**, not just symptoms
- **Add tests** if possible
- **Document the fix** in commit message

### Improving Documentation

- **Be clear and concise**
- **Include examples** when helpful
- **Keep it up to date** with code changes
- **Fix typos** - they're always welcome!

### Performance Improvements

- **Measure before and after**
- **Explain the improvement**
- **Don't sacrifice readability** for micro-optimizations

## Questions?

If you have questions about contributing:

- Open an issue with the `question` label
- Check existing issues and PRs
- Review the README.md for setup instructions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Hugo Mana Theme! 🚀

