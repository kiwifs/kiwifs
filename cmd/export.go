package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/bootstrap"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/docexport"
	"github.com/kiwifs/kiwifs/internal/exporter"
	"github.com/kiwifs/kiwifs/internal/webhooks"
	"github.com/spf13/cobra"
)

var exportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export knowledge base to data formats or rendered documents",
	Long: `Export knowledge base files to data formats (JSONL, CSV, Parquet) or
render documents to publication-ready formats (PDF, HTML, slides, static site).

Data formats export structured data from your knowledge base.
Document formats render markdown into typeset output using external tools
(Pandoc for PDF/HTML, Marp for slides, MkDocs for static sites).`,
	Example: `  # Data export
  kiwifs export --format jsonl --output data.jsonl
  kiwifs export --format jsonl --output data.jsonl --webhook https://api.vercel.com/v1/integrations/deploy/xxx
  kiwifs export --format csv --columns name,status --output data.csv

  # Document export
  kiwifs export --format pdf --path docs/report.md --output report.pdf
  kiwifs export --format pdf --path docs/ --output book.pdf --theme paper
  kiwifs export --format html --path docs/page.md --self-contained
  kiwifs export --format slides --path talk.md --output slides.html
  kiwifs export --format site --path docs/ --output docs-site.zip
  kiwifs export --format mkdocs --output ./docs-site --site-name "My KB"`,
	RunE: runExport,
}

func init() {
	rootCmd.AddCommand(exportCmd)

	exportCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	exportCmd.Flags().String("format", "jsonl", "output format: jsonl | csv | parquet | mkdocs | pdf | html | slides | site")
	exportCmd.Flags().StringP("output", "o", "", "output file (default: stdout for data formats)")
	exportCmd.Flags().String("path", "", "file or directory path to export")

	// Data export flags.
	exportCmd.Flags().String("columns", "", "comma-separated frontmatter fields (CSV mode)")
	exportCmd.Flags().Bool("include-content", false, "include full markdown content")
	exportCmd.Flags().Bool("include-links", false, "include outgoing and incoming links")
	exportCmd.Flags().Bool("include-embeddings", false, "include vector embeddings")
	exportCmd.Flags().Int("limit", 0, "max files to export (0 = unlimited)")

	// Document export flags.
	exportCmd.Flags().String("theme", "", "theme for document export (paper, modern, minimal, dark, presentation)")
	exportCmd.Flags().Bool("self-contained", false, "embed all resources in output (HTML/PDF)")
	exportCmd.Flags().String("bibliography", "", "path to .bib/.json bibliography file")
	exportCmd.Flags().String("csl", "", "citation style (apa, ieee, chicago, vancouver, harvard)")
	exportCmd.Flags().Bool("crossref", false, "enable cross-references (figures, tables, equations)")
	exportCmd.Flags().String("pdf-engine", "", "PDF engine: typst | xelatex (default: auto-detect)")
	exportCmd.Flags().String("slide-format", "html", "slide output format: html | pdf | pptx")
	exportCmd.Flags().String("site-name", "", "site name for MkDocs export")
	exportCmd.Flags().String("site-url", "", "site URL for MkDocs export")
	exportCmd.Flags().String("repo-url", "", "repository URL for MkDocs export")

	exportCmd.Flags().String("webhook", "", "POST export metadata to this URL after a successful export")
	exportCmd.Flags().String("webhook-secret", "", "HMAC signing secret for the export webhook (overrides config)")
}

// isDocumentFormat returns true if the format is a document rendering format.
func isDocumentFormat(format string) bool {
	switch format {
	case "pdf", "html", "slides", "site":
		return true
	default:
		return false
	}
}

func runExport(cmd *cobra.Command, _ []string) error {
	format, _ := cmd.Flags().GetString("format")

	if format == "mkdocs" {
		return runMkDocsExport(cmd)
	}

	if isDocumentFormat(format) {
		return runDocumentExport(cmd)
	}
	return runDataExport(cmd)
}

func runMkDocsExport(cmd *cobra.Command) error {
	root, _ := cmd.Flags().GetString("root")
	output, _ := cmd.Flags().GetString("output")
	path, _ := cmd.Flags().GetString("path")
	siteName, _ := cmd.Flags().GetString("site-name")
	siteURL, _ := cmd.Flags().GetString("site-url")
	repoURL, _ := cmd.Flags().GetString("repo-url")

	if output == "" {
		return fmt.Errorf("--output directory is required for mkdocs export")
	}

	cfg, err := config.Load(root)
	if err != nil {
		cfg = &config.Config{}
	}
	cfg.Storage.Root = root

	stack, err := bootstrap.Build("export", root, cfg)
	if err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	defer stack.Close()

	count, err := exporter.ExportMkDocs(cmd.Context(), stack.Store, exporter.MkDocsOptions{
		OutputDir:  output,
		PathPrefix: path,
		SiteName:   siteName,
		SiteURL:    siteURL,
		RepoURL:    repoURL,
	})
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Exported %d files to MkDocs project at %s\n", count, output)
	return nil
}

// runDataExport handles JSONL/CSV/Parquet data export (existing functionality).
func runDataExport(cmd *cobra.Command) error {
	root, _ := cmd.Flags().GetString("root")
	format, _ := cmd.Flags().GetString("format")
	output, _ := cmd.Flags().GetString("output")
	path, _ := cmd.Flags().GetString("path")
	columnsStr, _ := cmd.Flags().GetString("columns")
	includeContent, _ := cmd.Flags().GetBool("include-content")
	includeLinks, _ := cmd.Flags().GetBool("include-links")
	includeEmb, _ := cmd.Flags().GetBool("include-embeddings")
	limit, _ := cmd.Flags().GetInt("limit")

	if format != "jsonl" && format != "csv" && format != "parquet" {
		return fmt.Errorf("unsupported format: %s (use jsonl, csv, parquet, mkdocs, pdf, html, slides, or site)", format)
	}

	cfg, err := config.Load(root)
	if err != nil {
		cfg = &config.Config{}
	}
	cfg.Storage.Root = root

	stack, err := bootstrap.Build("export", root, cfg)
	if err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	defer stack.Close()

	var columns []string
	if columnsStr != "" {
		columns = strings.Split(columnsStr, ",")
		for i := range columns {
			columns[i] = strings.TrimSpace(columns[i])
		}
	}

	var w *os.File
	if output != "" {
		w, err = os.Create(output)
		if err != nil {
			return fmt.Errorf("create output: %w", err)
		}
		defer w.Close()
	} else {
		w = os.Stdout
	}

	opts := exporter.Options{
		Format:            format,
		PathPrefix:        path,
		Columns:           columns,
		IncludeContent:    includeContent,
		IncludeLinks:      includeLinks,
		IncludeEmbeddings: includeEmb,
		Output:            w,
		Limit:             limit,
	}

	if includeEmb && output != "" {
		ext := filepath.Ext(output)
		schemaPath := strings.TrimSuffix(output, ext) + ".schema.json"
		sf, err := os.Create(schemaPath)
		if err != nil {
			return fmt.Errorf("create schema: %w", err)
		}
		defer sf.Close()
		opts.SchemaWriter = sf
	}

	ctx := cmd.Context()
	count, err := exporter.Export(ctx, stack.Store, stack.Searcher, stack.Vectors, opts)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}

	if output != "" {
		fmt.Fprintf(os.Stderr, "Exported %d files to %s\n", count, output)
	}

	webhookURL, _ := cmd.Flags().GetString("webhook")
	if webhookURL != "" {
		webhookSecret, _ := cmd.Flags().GetString("webhook-secret")
		if err := notifyExportWebhook(cmd.Context(), webhookURL, resolveWebhookSecret(cfg, webhookURL, webhookSecret), format, count, output); err != nil {
			return fmt.Errorf("webhook: %w", err)
		}
	}
	return nil
}

// runDocumentExport handles PDF/HTML/slides/site document rendering.
func runDocumentExport(cmd *cobra.Command) error {
	root, _ := cmd.Flags().GetString("root")
	format, _ := cmd.Flags().GetString("format")
	output, _ := cmd.Flags().GetString("output")
	path, _ := cmd.Flags().GetString("path")
	theme, _ := cmd.Flags().GetString("theme")
	selfContained, _ := cmd.Flags().GetBool("self-contained")
	bibliography, _ := cmd.Flags().GetString("bibliography")
	csl, _ := cmd.Flags().GetString("csl")
	crossref, _ := cmd.Flags().GetBool("crossref")
	pdfEngine, _ := cmd.Flags().GetString("pdf-engine")
	slideFormat, _ := cmd.Flags().GetString("slide-format")
	siteName, _ := cmd.Flags().GetString("site-name")
	siteURL, _ := cmd.Flags().GetString("site-url")
	repoURL, _ := cmd.Flags().GetString("repo-url")

	if path == "" {
		return fmt.Errorf("--path is required for document export (specify a file or directory)")
	}

	docFormat, err := docexport.ParseFormat(format)
	if err != nil {
		return err
	}

	cfg, err := config.Load(root)
	if err != nil {
		cfg = &config.Config{}
	}
	cfg.Storage.Root = root

	stack, err := bootstrap.Build("export", root, cfg)
	if err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	defer stack.Close()

	// Create file provider and registry.
	provider := docexport.NewStorageProvider(stack.Store, root)
	registry := docexport.NewRegistry()
	registry.Register(docexport.NewPDFExporter(provider, root))
	registry.Register(docexport.NewHTMLExporter(provider, root))
	registry.Register(docexport.NewSlidesExporter(provider, root))
	registry.Register(docexport.NewSiteExporter(provider, stack.Store, root))

	opts := docexport.ExportOpts{
		Format:        docFormat,
		InputPath:     path,
		Theme:         theme,
		SelfContained: selfContained,
		Bibliography:  bibliography,
		CSLStyle:      csl,
		CrossRef:      crossref,
		PDFEngine:     pdfEngine,
		SlideFormat:   slideFormat,
		SiteName:      siteName,
		SiteURL:       siteURL,
		RepoURL:       repoURL,
	}

	ctx, cancel := context.WithTimeout(cmd.Context(), 5*time.Minute)
	defer cancel()

	result, err := registry.Export(ctx, opts)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}

	// Write output.
	if output == "" {
		// Auto-generate output filename.
		output = result.Filename
	}

	if err := os.WriteFile(output, result.Data, 0644); err != nil {
		return fmt.Errorf("write output: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Exported %s to %s (%d bytes)\n", format, output, len(result.Data))

	webhookURL, _ := cmd.Flags().GetString("webhook")
	if webhookURL != "" {
		webhookSecret, _ := cmd.Flags().GetString("webhook-secret")
		if err := notifyExportWebhook(cmd.Context(), webhookURL, resolveWebhookSecret(cfg, webhookURL, webhookSecret), format, 1, output); err != nil {
			return fmt.Errorf("webhook: %w", err)
		}
	}
	return nil
}

func resolveWebhookSecret(cfg *config.Config, webhookURL, flagSecret string) string {
	if flagSecret != "" {
		return flagSecret
	}
	for _, we := range cfg.WebhookEntries {
		if we.URL == webhookURL && we.Secret != "" {
			return we.Secret
		}
	}
	return ""
}

func notifyExportWebhook(ctx context.Context, url, secret, format string, fileCount int, output string) error {
	_, err := webhooks.Post(ctx, url, secret, webhooks.ExportNotification{
		Type:      webhooks.ExportCompletedType,
		Format:    format,
		FileCount: fileCount,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Output:    output,
	}, nil)
	return err
}
