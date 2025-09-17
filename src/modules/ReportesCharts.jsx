import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';

export function ReportesPieChart({ data, title }) {
  const theme = useTheme();
  const COLORS = [
    theme.palette.primary.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.error.main,
    theme.palette.secondary.main,
    theme.palette.info.main,
  ];

  return (
    <Box sx={{ width: '100%', maxWidth: 400, mx: 'auto', mb: 3 }}>
      <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>{title}</Typography>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function ReportesBarChart({ data, title, xKey, yKey }) {
  const theme = useTheme();
  const barFill = theme.palette.mode === 'dark' ? '#F2B05F' : theme.palette.primary.main;
  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', mb: 3 }}>
      <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>{title}</Typography>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey={yKey} fill={barFill} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function ReportesLineChart({ data, title, xKey, lines = [] }) {
  const theme = useTheme();
  return (
    <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', mb: 3 }}>
      <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>{title}</Typography>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          {lines.map((l) => (
            <Line key={l.dataKey} type="monotone" dataKey={l.dataKey} stroke={l.color || theme.palette.primary.main} strokeWidth={2} dot={{ r: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function ReportesAreaChart({ data, title, xKey, areas = [] }) {
  return (
    <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', mb: 3 }}>
      <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>{title}</Typography>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          {areas.map((a) => (
            <Area key={a.dataKey} type="monotone" dataKey={a.dataKey} stackId="1" stroke={a.color} fill={a.color} fillOpacity={0.25} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function ReportesHorizontalBarChart({ data, title, xKey, yKey }) {
  const theme = useTheme();
  const barFill = theme.palette.mode === 'dark' ? '#F2B05F' : theme.palette.primary.main;
  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', mb: 3 }}>
      <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>{title}</Typography>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" />
          <YAxis dataKey={xKey} type="category" />
          <Tooltip />
          <Bar dataKey={yKey} fill={barFill} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
