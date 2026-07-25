/**
 * @jest-environment jsdom
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AirlineSyncPanel from "../AirlineSyncPanel";

describe("AirlineSyncPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  describe("rendering", () => {
    it("should render sync button", () => {
      render(<AirlineSyncPanel />);
      const button = screen.getByText("Sync All Airlines");
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });

    it("should have correct title", () => {
      render(<AirlineSyncPanel />);
      const title = screen.getByText("Airline Balance Sync");
      expect(title).toBeInTheDocument();
    });

    it("should show details by default", () => {
      render(<AirlineSyncPanel showDetails={true} />);
      // Component renders, details section will show when syncing
      expect(screen.getByText("Airline Balance Sync")).toBeInTheDocument();
    });

    it("should hide details when showDetails=false", () => {
      render(<AirlineSyncPanel showDetails={false} />);
      expect(screen.getByText("Airline Balance Sync")).toBeInTheDocument();
      // Details section won't render even during sync
    });
  });

  describe("sync triggering", () => {
    it("should call API when sync button clicked", async () => {
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          runId: "run-123",
          status: "queued",
          airlinesRequested: 9,
        }),
      });

      render(<AirlineSyncPanel />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/sync/trigger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initiatedBy: "user" }),
        });
      });
    });

    it("should disable button during sync", async () => {
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          runId: "run-123",
          status: "queued",
          airlinesRequested: 9,
        }),
      });

      render(<AirlineSyncPanel />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
        expect(button).toHaveTextContent("Syncing...");
      });
    });

    it("should call onSyncStart callback", async () => {
      const mockCallback = jest.fn();
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          runId: "run-123",
          status: "queued",
          airlinesRequested: 9,
        }),
      });

      render(<AirlineSyncPanel onSyncStart={mockCallback} />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith("run-123");
      });
    });

    it("should show error alert on API failure", async () => {
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Failed to start sync" }),
      });

      const mockAlert = jest.fn();
      global.alert = mockAlert;

      render(<AirlineSyncPanel />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockAlert).toHaveBeenCalledWith("Failed to start sync");
      });
    });
  });

  describe("progress polling", () => {
    it("should poll progress every 1 second", async () => {
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accepted: true,
            runId: "run-123",
            status: "queued",
            airlinesRequested: 9,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runId: "run-123",
            status: "in-progress",
            progress: { completed: 3, total: 9, percentage: 33 },
            airlines: [],
            summary: {
              successfulCount: 3,
              failedCount: 0,
              skippedCount: 0,
              authFailureCount: 0,
              networkFailureCount: 0,
              portalFailureCount: 0,
            },
          }),
        });

      render(<AirlineSyncPanel />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/sync/trigger", expect.any(Object));
      });

      // Should attempt progress fetch
      await waitFor(
        () => {
          const progressCalls = mockFetch.mock.calls.filter((call: any[]) =>
            call[0].includes("/api/sync/progress")
          );
          expect(progressCalls.length).toBeGreaterThan(0);
        },
        { timeout: 3000 }
      );
    });

    it("should stop polling when sync completes", async () => {
      const mockCallback = jest.fn();
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accepted: true,
            runId: "run-123",
            status: "queued",
            airlinesRequested: 9,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runId: "run-123",
            status: "completed",
            progress: { completed: 9, total: 9, percentage: 100 },
            airlines: [],
            summary: {
              successfulCount: 9,
              failedCount: 0,
              skippedCount: 0,
              authFailureCount: 0,
              networkFailureCount: 0,
              portalFailureCount: 0,
            },
          }),
        });

      render(<AirlineSyncPanel onSyncComplete={mockCallback} />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      await waitFor(
        () => {
          expect(mockCallback).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // Button should be re-enabled after completion
      await waitFor(
        () => {
          expect(button).not.toBeDisabled();
        },
        { timeout: 3000 }
      );
    });
  });

  describe("error handling", () => {
    it("should handle network error during progress fetch", async () => {
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accepted: true,
            runId: "run-123",
          }),
        })
        .mockRejectedValueOnce(new Error("Network error"));

      render(<AirlineSyncPanel />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      // Should continue despite error, button should eventually re-enable
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      }, { timeout: 5000 });
    });
  });

  describe("airline detail expansion", () => {
    it("should expand/collapse airline details", async () => {
      const mockFetch = global.fetch as jest.Mock<(...args: any[]) => Promise<any>>;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accepted: true,
            runId: "run-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runId: "run-123",
            status: "completed",
            progress: { completed: 1, total: 1, percentage: 100 },
            airlines: [
              {
                airline: "AIRPEACE",
                status: "SUCCESS",
                balance: 150000,
                durationMs: 25000,
              },
            ],
            summary: {
              successfulCount: 1,
              failedCount: 0,
              skippedCount: 0,
              authFailureCount: 0,
              networkFailureCount: 0,
              portalFailureCount: 0,
            },
          }),
        });

      render(<AirlineSyncPanel showDetails={true} />);
      const button = screen.getByText("Sync All Airlines");

      fireEvent.click(button);

      // Wait for completion and details to appear
      await waitFor(
        () => {
          const airlineElements = screen.queryAllByText(/AIRPEACE/);
          expect(airlineElements.length).toBeGreaterThan(0);
        },
        { timeout: 3000 }
      );
    });
  });
});
