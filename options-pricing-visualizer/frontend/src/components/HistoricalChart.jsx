import { useEffect, useRef } from "react";
import * as d3 from "d3";

export default function HistoricalChart({ data, title }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const width = 720;
    const height = 360;
    const margin = { top: 28, right: 30, bottom: 44, left: 64 };

    const svg = d3.select(svgRef.current);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();

    if (!data || data.length === 0) {
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("class", "chart-empty")
        .text("No history loaded yet");
      return;
    }

    const parsedData = data
      .map((point) => ({
        ...point,
        date: new Date(point.date)
      }))
      .filter((point) => !Number.isNaN(point.date.getTime()));

    if (parsedData.length === 0) {
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("class", "chart-empty")
        .text("No usable date data returned");
      return;
    }

    const x = d3
      .scaleTime()
      .domain(d3.extent(parsedData, (d) => d.date))
      .nice()
      .range([margin.left, width - margin.right]);

    const y = d3
      .scaleLinear()
      .domain(d3.extent(parsedData, (d) => d.close))
      .nice()
      .range([height - margin.bottom, margin.top]);

    const grid = svg.append("g").attr("class", "chart-grid");
    grid
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-(width - margin.left - margin.right))
          .tickFormat("")
      );
    grid
      .append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickSize(-(height - margin.top - margin.bottom))
          .tickFormat("")
      );

    const line = d3
      .line()
      .x((d) => x(d.date))
      .y((d) => y(d.close))
      .curve(d3.curveMonotoneX);

    svg
      .append("path")
      .datum(parsedData)
      .attr("class", "chart-line")
      .attr("d", line);

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));

    svg
      .append("text")
      .attr("class", "chart-title")
      .attr("x", margin.left)
      .attr("y", 18)
      .text(title);

    const focus = svg.append("g").attr("class", "chart-focus").style("display", "none");
    focus.append("circle").attr("r", 4);
    const focusText = focus.append("text").attr("y", -12);

    const bisect = d3.bisector((d) => d.date).left;

    svg
      .append("rect")
      .attr("class", "chart-overlay")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", width - margin.left - margin.right)
      .attr("height", height - margin.top - margin.bottom)
      .on("mousemove", (event) => {
        const [xPos] = d3.pointer(event);
        const xValue = x.invert(xPos);
        const index = bisect(parsedData, xValue, 1);
        const prev = parsedData[index - 1] || parsedData[0];
        const next = parsedData[index] || parsedData[parsedData.length - 1];
        const point = xValue - prev.date > next.date - xValue ? next : prev;

        focus.style("display", null);
        focus.attr("transform", `translate(${x(point.date)},${y(point.close)})`);
        focusText.text(`${d3.timeFormat("%Y-%m-%d")(point.date)}  ${point.close.toFixed(2)}`);
      })
      .on("mouseleave", () => focus.style("display", "none"));
  }, [data, title]);

  return <svg ref={svgRef} className="chart" role="img" />;
}
