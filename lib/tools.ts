export type ToolName = "calculator" | "time" | "stats" | "weather" | "currency" | "searchChatHistory";

export async function executeTool(name: ToolName, input?: string) {
  const rawInput = (input || "").trim();
  switch (name) {
    case "calculator": {
      try {
        let expr = rawInput;
        try {
          const parsed = JSON.parse(rawInput);
          expr = String(parsed.expression || parsed.input || rawInput);
        } catch {
          // ignore
        }
        // Very small sandboxed eval for basic arithmetic only
        // Allow digits, whitespace, + - * / ( ) and decimals
        const safe = expr.replace(/[^0-9+\-*/(). %]/g, "");
        const result = Function(`"use strict"; return (${safe})`)();
        return { success: true, result: String(result) };
      } catch {
        return { success: false, error: "Calculator error" };
      }
    }
    case "time": {
      return { success: true, result: new Date().toString() };
    }

    case "stats": {
      let text = rawInput;
      try {
        const parsed = JSON.parse(rawInput);
        text = String(parsed.text || parsed.input || rawInput);
      } catch {
        // ignore
      }
      const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
      const chars = text.length;
      return { success: true, result: JSON.stringify({ words, chars }) };
    }
    case "weather": {
      let city = rawInput;
      try {
        const parsed = JSON.parse(rawInput);
        city = String(parsed.city || parsed.location || rawInput);
      } catch {
        // ignore
      }
      if (!city.trim()) city = "San Francisco";

      const conditions = ["Sunny", "Partly Cloudy", "Rainy", "Cloudy", "Windy", "Stormy"];
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      const tempC = Math.floor(Math.random() * 20) + 10; // 10 to 30 C
      const tempF = Math.round((tempC * 9) / 5 + 32);
      const humidity = Math.floor(Math.random() * 50) + 40; // 40% to 90%
      const windSpeed = Math.floor(Math.random() * 25) + 5; // 5 to 30 km/h
      return {
        success: true,
        result: JSON.stringify({
          location: city,
          temperature: `${tempC}°C / ${tempF}°F`,
          condition,
          humidity: `${humidity}%`,
          wind: `${windSpeed} km/h`,
        }),
      };
    }
    case "currency": {
      let amount = 0;
      let from = "";
      let to = "";
      let parsedOk = false;

      try {
        const parsed = JSON.parse(rawInput);
        if (parsed.amount !== undefined && parsed.from && parsed.to) {
          amount = parseFloat(parsed.amount);
          from = String(parsed.from).trim().toUpperCase();
          to = String(parsed.to).trim().toUpperCase();
          parsedOk = true;
        } else if (parsed.query) {
          const match = String(parsed.query).toUpperCase().match(/^([\d.]+)\s+([A-Z]{3})\s+(?:TO\s+)?([A-Z]{3})$/);
          if (match) {
            amount = parseFloat(match[1]);
            from = match[2];
            to = match[3];
            parsedOk = true;
          }
        }
      } catch {
        // ignore
      }

      if (!parsedOk) {
        const match = rawInput.toUpperCase().match(/^([\d.]+)\s+([A-Z]{3})\s+(?:TO\s+)?([A-Z]{3})$/);
        if (!match) {
          return { success: false, error: "Invalid currency query format. Use: '<amount> <from_currency> to <to_currency>', e.g., '100 USD to EUR'" };
        }
        amount = parseFloat(match[1]);
        from = match[2];
        to = match[3];
      }

      // Simulated exchange rates with USD base
      const rates: Record<string, number> = {
        USD: 1.0,
        EUR: 0.92,
        GBP: 0.78,
        JPY: 155.4,
        CAD: 1.36,
        AUD: 1.51,
        CNY: 7.24,
      };

      if (!(from in rates) || !(to in rates)) {
        return { success: false, error: `Supported currencies are: ${Object.keys(rates).join(", ")}` };
      }

      const usdAmount = amount / rates[from];
      const convertedAmount = usdAmount * rates[to];
      const resultVal = convertedAmount.toFixed(2);

      return {
        success: true,
        result: JSON.stringify({
          original: `${amount} ${from}`,
          converted: `${resultVal} ${to}`,
          rate: (rates[to] / rates[from]).toFixed(4),
        }),
      };
    }
    default:
      return { success: false, error: "Unknown tool" };
  }
}

export const TOOL_DISPLAY: Record<string, string> = {
  calculator: "🔧 Using Calculator...",
  time: "🕒 Getting Current Time...",
  stats: "📊 Calculating Statistics...",
  weather: "🌤️ Fetching Weather Data...",
  currency: "💱 Converting Currency...",
  searchChatHistory: "🔍 Searching Chat History...",
};

