<script setup>
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const props = defineProps({
  income: { type: Array, default: () => [2.3, 3.5, 2.7, 5.2, 4.1, 4.8, 6.1] },
  expense: { type: Array, default: () => [1.2, 2.4, 2.1, 3.5, 2.4, 3.1, 2.9] },
})

const chartData = computed(() => ({
  labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul'],
  datasets: [
    {
      label: 'Ingresos',
      data: props.income,
      backgroundColor: '#67e8f9',
      borderRadius: 8,
    },
    {
      label: 'Gastos',
      data: props.expense,
      backgroundColor: '#8b5cf6',
      borderRadius: 8,
    },
  ],
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: '#dfeaf8' },
    },
  },
  scales: {
    x: {
      ticks: { color: '#a7b7cd' },
      grid: { display: false },
    },
    y: {
      ticks: { color: '#a7b7cd' },
      grid: { color: 'rgba(148, 163, 184, 0.12)' },
    },
  },
}
</script>

<template>
  <div class="financial-chart min-w-0 overflow-hidden h-56 w-full sm:h-64">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
